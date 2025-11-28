import https from 'https';
import fs from 'fs';

const apiKey = 'AIzaSyC-lSgwyZVFL7UOuTNcCj8aPDI_1lPXMV0';
const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        try {
            const json = JSON.parse(data);
            if (json.error) {
                console.error('API Error:', json.error);
            } else {
                const names = json.models.map(m => m.name).join('\n');
                fs.writeFileSync('models_list.txt', names);
                console.log('Models saved to models_list.txt');
            }
        } catch (e) {
            console.error('Parse Error:', e);
        }
    });
});
