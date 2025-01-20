var mysql = require("mysql");

var hostname = "ewk5w.h.filess.io";
var database = "noisecar_viewjobup";
var port = "3307";
var username = "noisecar_viewjobup";
var password = "6aa2d7447c0cdbaa95ecddb873841d21af9ee310";

var con = mysql.createConnection({
  host: hostname,
  user: username,
  password,
  database,
  port,
});

con.connect(function (err) {
  if (err) throw err;
  console.log("Connected!");
});

con.query("SELECT 1+1").on("result", function (row) {
  console.log(row);
});
