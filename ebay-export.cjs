const https = require('https');
const fs = require('fs');

const EBAY_COOKIE = '__uzma=eb6014f8-463c-4eef-8f78-d4ca4ea56c2d; __uzmb=1780683823; __uzme=9128; __ssds=2; __ssuzjsr2=a9be0cd8e; __uzmaj2=0a4f9b91-a853-43c1-b239-08d9ed7e1080; __uzmbj2=1780683824; ds1=ats/1780684694339; cpt=%5Ecpt_guid%3De8aa6d95-0399-4af5-839f-1e18d54888d1%5Ecpt_prvd%3Dhcaptcha%5E; __uzmlj2=gkwUkh11XWRner1ZKg0IchMki/fstR2fnvRMxFb+dJA=; ds2=amsg/9906da8a19e0a67d4cfdab68fffd64fa^sotr/b95E4zzzzzzz^; ebay=%5Ejs%3D1%5EsfLMD%3D0%5Esin%3Din%5Esbf%3D%2340000004%5E; bm_so=B46E8ACE16DBCD45F5C1504E24EF97FB14D3547BF7F8BF3B57F2AB6CA2400C9E~YAAQNHIcuD9Ji5eeAQAA4CY3mQdaQAIXIIs77qn88pZrb58S+m/AIhuJV2zo3aZwxf2Unzpez7yAMJswsm79v2K+e9sGCMGubgn6bYdXQDJiLatFAo6TMeGHR4xBjTM8FdzdD+J3xCPYuJyHQeSSexkS6iYrV/ZkOWU5yN/Hj1jQRmKBaEqP8QKj1i+ApJGxjleYXMGs9DDlS0qHpCLhZZ/Wpdi5Bd/gecIwV+gcHoSEzrAZM8lNtIRIXBYpRJ5oiXqNdk6AtiqKgxm1MJEdWqJ0rQK4rpbLjZyJk/IeVSy/HRfrgewYYivUG8w4koQ8CXS6kGuyBYL2JARfDmUxSWrLJGHWDh8zHJ6EASAWfXVXdo62CVBUi+zmc8YMylW7ZmjRoIuF3an2R2pFRsJDiGKwZ9Nbl48W1Ks2Loe7wZ2+of9VKIG7TNTx3HeG+MPXxwQXkLcZLqwuVkSG+InJeJw=; __uzmcj2=458275850535; __uzmdj2=1780686989; __uzmfj2=7f60002dde0810-4f81-4232-9d77-d24b9769cd1917806838246503164802-a9ea6bcceb1cdac758; __uzmc=9826116681715; __uzmd=1780686992; __uzmf=7f60002dde0810-4f81-4232-9d77-d24b9769cd1917806838237253168588-80f4d9f3602a0e2e166; bm_lso=B46E8ACE16DBCD45F5C1504E24EF97FB14D3547BF7F8BF3B57F2AB6CA2400C9E~YAAQNHIcuD9Ji5eeAQAA4CY3mQdaQAIXIIs77qn88pZrb58S+m/AIhuJV2zo3aZwxf2Unzpez7yAMJswsm79v2K+e9sGCMGubgn6bYdXQDJiLatFAo6TMeGHR4xBjTM8FdzdD+J3xCPYuJyHQeSSexkS6iYrV/ZkOWU5yN/Hj1jQRmKBaEqN/ZkOWU5yN/Hj1jQRmKBaEqP8QKj1i+ApJGxjleYXMGs9DDlS0qHpCLhZZ/Wpdi5Bd/gecIwV+gcHoSEzrAZM8lNtIRIXBYpRJ5oiXqNdk6AtiqKgxm1MJEdWqJ0rQK4rpbLjZyJk/IeVSy/HRfrgewYYivUG8w4koQ8CXS6kGuyBYL2JARfDmUxSWrLJGHWDh8zHJ6EASAWfXVXdo62CVBUi+zmc8YMylW7ZmjRoIuF3an2R2pFRsJDiGKwZ9Nbl48W1Ks2Loe7wZ2+of9VKIG7TNTx3HeG+MPXxwQXkLcZLqwuVkSG+InJeJw=~1780686993133; bm_sv=7AEB5F29EB7D84F5AEBF76382D8B3924~YAAQD/4xF0FRgIeeAQAA9jo3mQCB0vyEzJDBCtSGuHb7eKe6E6+VU4BAL+tjyWUNdVcGNOnURvhDLzpEk9GzsP4o9Fb501y1OQ7GMnrMzdpZhYjvhqme7OsMQTIRulNSbP9t0zD10fk3Sfgl+7IWXndXvhH3hMsu3Xwyyk/dUelu9OljG2wqW6Dg1cPECoVn/mov+XVF9TF+QTtRy29lSBp4/cY+6dccyU6rNmMNX8P/d0Tnw9w/Cr7w5df8aWk=~1; ds2=amsg/9906da8a19e0a67d4cfdab68fffd64fa^; dp1=bu1p/YmVub190YQ**6de58859^kms/in6de58859^pbf/%23200000000000000000080000000046c0454d9^u1f/Eater6de58859^tzo/1a46a232394^bl/US6de58859^; totp=1780687205887.GVq/DrPxsZawkZbyDNmd4q7Zqyx/LoEsbKDJfCusFA1cpruHJnuWTtjzVHU3aPzx+FlXzeh0u7VkSIyDg23xRg==.H3TJZ7hmat0WETwTNLDhCd5u4Dot7kKgylwla_I59Hc';


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
