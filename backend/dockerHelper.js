const Docker = require('dockerode');
const fs = require('fs');
const tar = require('tar-fs');
const path = require('path');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const DOCKER_NETWORK = process.env.DOCKER_NETWORK || 'proxy';

async function buildImageFromFolder(folderPath, imageTag, onProgressLine) {
  return new Promise((resolve, reject) => {
    const tarStream = tar.pack(folderPath);
    docker.buildImage(tarStream, { t: imageTag }, (err, stream) => {
      if (err) return reject(err);
      docker.modem.followProgress(stream, (err, output) => {
        if (err) return reject(err);
        resolve(output);
      }, (event) => {
        const str = JSON.stringify(event);
        if (onProgressLine) onProgressLine(str + "\n");
      });
    });
  });
}

async function createAndStartContainer(imageTag, containerName, internalPort, labels = {}) {
  // Create container (no network yet)
  const createOpts = {
    name: containerName,
    Image: imageTag,
    Labels: labels,
    ExposedPorts: {
      [`${internalPort}/tcp`]: {}
    },
    HostConfig: {
      // not binding ports to host — Traefik will route inside docker network
      PortBindings: {}
    }
  };

  const container = await docker.createContainer(createOpts);

  // Connect to proxy network (must exist)
  try {
    const network = docker.getNetwork(DOCKER_NETWORK);
    await network.connect({ Container: container.id });
  } catch (e) {
    // network might not exist — ignore or throw
    console.error('Error connecting to network', e);
    throw e;
  }

  await container.start();
  return container.id;
}

async function getContainerStatus(containerId) {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    return {
      state: info.State,
      config: info.Config
    };
  } catch (e) {
    return null;
  }
}

async function getContainerLogs(containerId, tail = 1000) {
  try {
    const container = docker.getContainer(containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail: tail,
      timestamps: true
    });
    return logs.toString();
  } catch (e) {
    return `Error fetching logs: ${e.message}`;
  }
}

async function stopAndRemoveContainer(containerId) {
  try {
    const c = docker.getContainer(containerId);
    await c.stop().catch(()=>{});
    await c.remove().catch(()=>{});
    return true;
  } catch (e) {
    console.error('stopAndRemove error:', e);
    return false;
  }
}

async function removeImage(imageTag) {
  try {
    const img = docker.getImage(imageTag);
    await img.remove({ force: true }).catch(()=>{});
    return true;
  } catch (e) {
    console.error('removeImage error', e);
    return false;
  }
}

module.exports = {
  buildImageFromFolder,
  createAndStartContainer,
  getContainerStatus,
  getContainerLogs,
  stopAndRemoveContainer,
  removeImage
};
