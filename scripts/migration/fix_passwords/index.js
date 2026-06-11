const tcb = require('@cloudbase/node-sdk');
const fs = require('fs');

const app = tcb.init({
    env: 'nightshift-d0gong2x832b1270e',
    secretId: process.env.TCB_SECRET_ID || 'YOUR_SECRET_ID',
    secretKey: process.env.TCB_SECRET_KEY || 'YOUR_SECRET_KEY'
});
const db = app.database();

const raw = fs.readFileSync('users_export.json', 'utf8').replace(/^\uFEFF/, '');
const users = JSON.parse(raw)[0].results;

exports.main = async (event, context) => {
    let updated = 0;
    let actuallyModified = 0;
    
    for (const u of users) {
        try {
            const res = await db.collection('users')
                .where({ "data.username": u.username })
                .update({
                    data: {
                        "data.password_hash": u.password_hash
                    }
                });
            
            // res.stats.updated 才是真实被修改的文档数
            const modified = res.stats?.updated || 0;
            actuallyModified += modified;
            
            console.log(`${u.username}: matched=${res.stats?.matched || 0}, updated=${modified}`);
            updated++;
        } catch (e) {
            console.error(`Failed: ${u.username}`, e.message);
        }
    }
    
    return { 
        processed: updated, 
        actuallyModified, 
        total: users.length 
    };
};