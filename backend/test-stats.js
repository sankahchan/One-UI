const { execSync } = require('child_process');

async function test() {
  try {
    const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' })
    });
    const loginData = await loginRes.json();
    const token = loginData?.data?.token || '';

    if (!token) throw new Error('No token found');

    const statsRes = await fetch('http://127.0.0.1:3000/api/system/stats', {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    console.log('STATUS:', statsRes.status);
    console.log('PAYLOAD:', await statsRes.text());
  } catch (err) {
    console.error(err);
  }
}
test();
