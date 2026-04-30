const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.run("ALTER TABLE images ADD COLUMN is_main INTEGER DEFAULT 0", (err) => {
        if (err && !err.message.includes("duplicate column name")) {
            console.error("Error adding is_main to images:", err);
        } else {
            console.log("is_main column ready in images");
        }
    });
});
