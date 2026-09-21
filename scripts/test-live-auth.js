require('dotenv').config();

const base = process.env.APP_BASE_URL || 'http://localhost:4000';
const email = 'test.' + Date.now() + '@takeoff.local';
const phone = '+141555' + String(Date.now()).slice(-6);

async function api(path, body) {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  return { status: res.status, data };
}

(async () => {
  const signup = await api('/api/auth/signup', {
    fullName: 'Live Test Driver',
    email,
    phone,
    password: 'Password123!'
  });

  console.log('SIGNUP', JSON.stringify(signup));

  const adminLogin = await api('/api/auth/login', {
    email: process.env.ADMIN_EMAIL || 'admin@takeoff.local',
    password: process.env.ADMIN_PASSWORD || 'Admin@12345'
  });

  console.log('ADMIN_LOGIN', JSON.stringify(adminLogin));
})().catch((err) => {
  console.error('LIVE_AUTH_TEST_ERROR');
  console.error(err);
  process.exit(1);
});
