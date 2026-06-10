const https = require('https');
const fs = require('fs');

const EBAY_COOKIE = 'YOUR_COOKIE_HERE';

const options = {
  hostname: 'www.ebay.com',
  path: '/sh/lst/active?action=download&format=csv',
  method: 'GET',
  headers: {
    'Cookie': EBAY_COOKIE,
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Accept': 'text/csv,*/*',
    'Referer': 'https://www.ebay.com/sh/lst/active'
  }
};

console.log('Connecting to eBay...');

const req = https.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    if (data.includes('Item number') || data.includes('Title')) {
      fs.writeFileSync('/Users/taibenor/Desktop/my-ebay-listings.csv', data);
      console.log('SUCCESS! Saved to Desktop as my-ebay-listings.csv');
    } else {
      console.log('Need valid cookie. Preview:');
      console.log(data.substring(0, 300));
    }
  });
});

req.on('error', (e) => console.error('Error:', e.message));
req.end();
