const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs-extra');
const path = require('path');
const child_process = require('child_process');
const mongoose = require('mongoose');

const Deployment = require('./models/Deployment');
const { detectProjectType, writeDockerfileForType } = require('./detectAndDockerfileTemplates');
const {
  buildImageFromFolder,
  createAndStartContainer,
  getContainerStatus,
  getContainerLogs,
  stopAndRemoveContainer,
  removeImage
} = require('./dockerHelper');

const app = express();
app.use(cors());
app.use(bodyParser.json());

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/minideploy';
const PORT = process.env.PORT || 5000;
const BASE_DOMAIN = process.env.BASE_DOMAIN || 'lvh.me'; // lvh.me resolves wildcard to 127.0.0.1
const DATA_DIR = '/data/repos';

mongoose.connect(MONGO_URL).then(()=>console.log('Mongo connected')).catch(e => console.error(e));

async function gitClone(repoUrl, destPath) {
  await fs.ensureDir(path.dirname(destPath));
  return new Promise((resolve, reject) => {
    const cmd = `git clone --depth 1 ${repoUrl} ${destPath}`;
    child_process.exec(cmd, { maxBuffer: 1024 * 1024 * 10 }, (err, stdout, stderr) => {
      if (err) return reject({ err, stdout, stderr });
      resolve({ stdout, stderr });
    });
  });
}

// API: submit repo
app.post('/deploy', async (req, res) => {
  const { repoUrl, name } = req.body;
  if (!repoUrl) return res.status(400).json({ error: 'repoUrl is required' });

  const id = uuidv4().split('-')[0];
  const repoPath = path.join(DATA_DIR, id);
  const imageName = `mini_deploy_${id}`;
  const containerName = `mini_deploy_${id}`;
  const entry = new Deployment({ id, name: name || id, repoUrl, imageName, status: 'queued' });
  await entry.save();

  // Run clone/build/run as an awaited sequence (keeps client waiting until deployed)
  (async () => {
    try {
      entry.status = 'cloning';
      await entry.save();

      console.log('Cloning', repoUrl, '->', repoPath);
      await gitClone(repoUrl, repoPath);

      // detect type
      const { type, port } = detectProjectType(repoPath);
      entry.status = `detected:${type}`;
      await entry.save();

      // write Dockerfile
      writeDockerfileForType(repoPath, type);

      entry.status = 'building';
      await entry.save();

      // Build image
      let buildLog = '';
      const appendBuildLog = (line) => { buildLog += line; entry.logs.build = (entry.logs.build || '') + line; };
      await buildImageFromFolder(repoPath, imageName, appendBuildLog);

      entry.logs.build = buildLog;
      entry.status = 'creating_container';
      await entry.save();

      // Prepare labels for Traefik — expose by default
      const labels = {
        'traefik.enable': 'true',
        // router rule uses host: id.BASE_DOMAIN
        [`traefik.http.routers.${id}.rule`]: `Host(\`${id}.${BASE_DOMAIN}\`)`,
        // service points to internal port
        [`traefik.http.services.${id}.loadbalancer.server.port`]: String(port)
      };

      const containerId = await createAndStartContainer(imageName, containerName, port, labels);
      entry.containerId = containerId;
      entry.status = 'running';
      await entry.save();

      console.log('Deployment finished', id);
    } catch (err) {
      console.error('Deployment failed', err);
      entry.status = 'failed';
      entry.logs.build = entry.logs.build + '\nERROR:\n' + (err && err.stderr ? err.stderr : (err.message || JSON.stringify(err)));
      await entry.save();
    }
  })();

  // respond with id (deployment runs asynchronously inside container but backend will have kicked it off)
  res.json({ id, dashboardUrl: `http://localhost:3000`, previewUrl: `http://${id}.${BASE_DOMAIN}` });
});

// list deployments
app.get('/deployments', async (req, res) => {
  const list = await Deployment.find().sort({ createdAt: -1 }).lean();
  res.json(list);
});

// status
app.get('/status/:id', async (req, res) => {
  const { id } = req.params;
  const dep = await Deployment.findOne({ id });
  if (!dep) return res.status(404).json({ error: 'not found' });

  if (dep.containerId) {
    const status = await getContainerStatus(dep.containerId);
    return res.json({ deployment: dep, dockerStatus: status });
  } else {
    return res.json({ deployment: dep });
  }
});

// logs
app.get('/logs/:id', async (req, res) => {
  const { id } = req.params;
  const dep = await Deployment.findOne({ id });
  if (!dep) return res.status(404).json({ error: 'not found' });

  let runtime = '';
  if (dep.containerId) {
    runtime = await getContainerLogs(dep.containerId, 500);
  }
  res.json({ build: dep.logs.build || '', runtime });
});

// delete
app.delete('/delete/:id', async (req, res) => {
  const { id } = req.params;
  const dep = await Deployment.findOne({ id });
  if (!dep) return res.status(404).json({ error: 'not found' });

  try {
    if (dep.containerId) {
      await stopAndRemoveContainer(dep.containerId);
    }
    if (dep.imageName) {
      await removeImage(dep.imageName);
    }
    // remove repo folder
    await fs.remove(path.join(DATA_DIR, id));
    await dep.remove();
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// restart
app.post('/restart/:id', async (req, res) => {
  const { id } = req.params;
  const dep = await Deployment.findOne({ id });
  if (!dep) return res.status(404).json({ error: 'not found' });

  try {
    const c = require('dockerode')({ socketPath: '/var/run/docker.sock' });
    const container = c.getContainer(dep.containerId);
    await container.restart();
    dep.status = 'running';
    await dep.save();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('Backend listening on', PORT);
});
