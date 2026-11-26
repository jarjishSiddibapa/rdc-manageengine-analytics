const os = require('os');
const dgram = require('dgram');
const settings = require('./settings');

// The address people open the app on, for links in emails. It comes from the "web address" setting or from this PC itself,
// never from a request's Host header, so a forged request cannot point an email at another site.

// Adapters that exist only inside this PC (virtual machines, VPNs ...): other computers cannot reach them.
const VIRTUAL = /vethernet|virtualbox|vmware|hyper-v|wsl|docker|loopback|bluetooth|tailscale|zerotier|vpn|^(tap|tun|veth|br-)/i;
const isLoopback = host => /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\])$/i.test(host);
// Home and office network ranges first, in the order they are most often the real one.
const rank = ip => (ip.startsWith('192.168.') ? 0 : ip.startsWith('10.') ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3);

function ownAddresses(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, list] of Object.entries(interfaces)) {
    for (const a of list || []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal && !a.address.startsWith('169.254.')) found.push({ ip: a.address, virtual: VIRTUAL.test(name) });
    }
  }
  return found.sort((a, b) => Number(a.virtual) - Number(b.virtual) || rank(a.ip) - rank(b.ip));
}

// The address this PC would use to reach another network, which is the one its main network knows it by. Connecting a UDP
// socket only chooses a route: nothing is sent (192.0.2.1 is an address reserved for examples).
const routedAddress = () => new Promise(resolve => {
  const socket = dgram.createSocket('udp4');
  const done = ip => { try { socket.close(); } catch { /* already closed */ } resolve(ip); };
  socket.once('error', () => done(null));
  try { socket.connect(53, '192.0.2.1', () => done(socket.address().address)); } catch { done(null); }
});

// The best of this PC's addresses: the routed one if it is a real adapter, otherwise the first real adapter.
function pick(addresses, routed) {
  const real = addresses.filter(a => !a.virtual);
  const usable = real.length ? real : addresses;
  return (usable.find(a => a.ip === routed) || usable[0])?.ip || null;
}

const lanAddress = async () => pick(ownAddresses(), await routedAddress());

// "http://192.168.0.84:7780". Resolved each time, so a new address from the router is picked up without a restart.
async function appUrl() {
  const configured = settings.str('public_url').replace(/\/+$/, '');
  if (configured) return configured;
  const port = Number(process.env.PORT) || 7780;
  const host = String(process.env.HOST || '127.0.0.1').trim();
  if (isLoopback(host)) return `http://localhost:${port}`;
  if (host === '0.0.0.0' || host === '::') return `http://${(await lanAddress()) || 'localhost'}:${port}`;
  return `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

// Whether a link to this address opens only on the PC that runs the app.
const onlyThisPc = url => { try { return isLoopback(new URL(url).hostname); } catch { return false; } };

module.exports = { appUrl, onlyThisPc, lanAddress, ownAddresses, pick };
