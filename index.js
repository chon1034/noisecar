const mysql = require("mysql");

const hostname = "ewk5w.h.filess.io";
const database = "noisecar_viewjobup";
const port = "3307";
const username = "noisecar_viewjobup";
const password = "6aa2d7447c0cdbaa95ecddb873841d21af9ee310";

const con = mysql.createConnection({
  host: hostname,
  user: username,
  password,
  database,
  port,
});

con.connect(function (err) {
  if (err) {
    console.error("Error connecting to the database:", err);
    return;
  }
  console.log("Connected!");

  con.query("SELECT 1 + 1 AS solution", function (err, results) {
    if (err) throw err;
    console.log("The solution is:", results[0].solution);
    con.end(); // 關閉連線
  });
});
