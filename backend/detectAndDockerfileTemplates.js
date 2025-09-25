const fs = require('fs');
const path = require('path');

function readPackageJson(repoPath) {
  try {
    const pkgPath = path.join(repoPath, 'package.json');
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }
  } catch (e) {}
  return null;
}

function detectProjectType(repoPath) {
  // returns { type: 'react' | 'node' | 'python' | 'unknown', port: number }
  const pkg = readPackageJson(repoPath);
  if (fs.existsSync(path.join(repoPath, 'requirements.txt')) || fs.existsSync(path.join(repoPath, 'pyproject.toml'))) {
    return { type: 'python', port: 8000 };
  }
  if (pkg) {
    const deps = Object.assign({}, pkg.dependencies || {}, pkg.devDependencies || {});
    if (deps.react || deps['react-dom']) {
      return { type: 'react', port: 80 };
    }
    if (deps.next) {
      return { type: 'next', port: 3000 };
    }
    // assume generic node backend if it has express or start script
    if (deps.express || pkg.scripts?.start) {
      return { type: 'node', port: 3000 };
    }
  }
  // fallback
  return { type: 'node', port: 3000 };
}

function writeDockerfileForType(repoPath, type) {
  let content = '';
  if (type === 'react') {
    // build with node then serve with nginx
    content = `
# Build stage
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build

# Serve stage
FROM nginx:alpine
# copy build artifacts (supports CRA build dir or Vite dist)
RUN rm -rf /usr/share/nginx/html/*
COPY --from=build /app/build /usr/share/nginx/html
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
`.trim();
  } else if (type === 'next') {
    content = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npm run build
ENV PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "npm run start"]
`.trim();
  } else if (type === 'python') {
    content = `
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8000
CMD ["sh","-c","python3 app.py || uvicorn main:app --host 0.0.0.0 --port 8000"]
`.trim();
  } else {
    // generic node
    content = `
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production --legacy-peer-deps
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["sh","-c","npm start || node server.js || node index.js"]
`.trim();
  }

  fs.writeFileSync(path.join(repoPath, 'Dockerfile'), content, 'utf8');
  return content;
}

module.exports = { detectProjectType, writeDockerfileForType };
