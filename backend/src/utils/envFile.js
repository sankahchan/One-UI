const fs = require('fs');
const path = require('path');

const ENV_FILE_PATH = path.join(process.cwd(), '.env');

function readEnvFile() {
  try {
    return fs.readFileSync(ENV_FILE_PATH, 'utf8');
  } catch {
    return '';
  }
}

function updateEnvValues(updates) {
  let content = readEnvFile();

  for (const [key, value] of Object.entries(updates)) {
    const escaped = String(value).includes(' ') || String(value).includes('#')
      ? `"${String(value).replace(/"/g, '\\"')}"`
      : String(value);
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}=${escaped}`;

    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + '\n' + line + '\n';
    }

    process.env[key] = String(value);
  }

  fs.writeFileSync(ENV_FILE_PATH, content, 'utf8');
}

module.exports = { updateEnvValues, readEnvFile };
