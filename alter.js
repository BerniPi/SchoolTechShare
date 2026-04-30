const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.run("ALTER TABLE users ADD COLUMN invite_token TEXT UNIQUE", (err) => {
        if (err && !err.message.includes("duplicate column name")) {
            console.error("Error adding invite_token:", err);
        } else {
            console.log("invite_token column ready");
        }
    });

    db.run("ALTER TABLE users ADD COLUMN name TEXT", (err) => {
        if (err && !err.message.includes("duplicate column name")) {
            console.error("Error adding name:", err);
        } else {
            console.log("name column ready");
        }
    });
});
