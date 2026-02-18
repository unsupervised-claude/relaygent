// Android DNS patch: override getaddrinfo with Node's resolve4
// Required because Android SSH sessions can't use system resolver
// .cjs extension ensures CommonJS context for --require flag
const dns = require('dns');
const net = require('net');
const origLookup = dns.lookup.bind(dns);
dns.lookup = function(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  if (net.isIP(hostname)) return origLookup(hostname, options, callback);
  if (options && options.all) {
    return dns.resolve4(hostname, (err, addrs) => {
      if (err || !addrs || !addrs.length) return origLookup(hostname, options, callback);
      callback(null, addrs.map(a => ({ address: a, family: 4 })));
    });
  }
  dns.resolve4(hostname, (err, addrs) => {
    if (err || !addrs || !addrs.length) return origLookup(hostname, options, callback);
    callback(null, addrs[0], 4);
  });
};
