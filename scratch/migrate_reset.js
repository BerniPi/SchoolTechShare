const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.resolve(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN reset_token TEXT", (err) => {
        if (err) console.log('reset_token column might already exist:', err.message);
        else console.log('Added reset_token column');
    });
    db.run("ALTER TABLE users ADD COLUMN reset_token_expiry TEXT", (err) => {
        if (err) console.log('reset_token_expiry column might already exist:', err.message);
        else console.log('Added reset_token_expiry column');
    });
});

db.close();
