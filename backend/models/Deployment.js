const mongoose = require('mongoose');

const DeploymentSchema = new mongoose.Schema({
  id: { type: String, index: true, unique: true },
  name: String,
  repoUrl: String,
  imageName: String,
  containerId: String,
  status: String, // cloning, building, running, failed, stopped
  logs: {
    build: { type: String, default: "" },
    runtime: { type: String, default: "" }
  },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Deployment', DeploymentSchema);
