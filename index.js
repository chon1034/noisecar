const mysql = require("mysql");

// 資料庫設定
const dbConfig = {
  host: "ewk5w.h.filess.io",
  user: "noisecar_viewjobup",
  password: "6aa2d7447c0cdbaa95ecddb873841d21af9ee310",
  database: "noisecar_viewjobup",
  port: 3307,
};

// 建立資料庫連線
function connectdb() {
  const connection = mysql.createConnection(dbConfig);
  connection.connect((err) => {
    if (err) {
      console.error("資料庫連線失敗：", err.message);
      return;
    }
    console.log("成功連線到資料庫！");
  });
  return connection;
}

// 更新資料函數
function updatedata(dataset, dbConnection, callback) {
  const sql = "UPDATE ?? SET CarOwner = ? WHERE CarNumber = ?";
  dbConnection.query(sql, dataset, (err, results) => {
    if (err) {
      callback(err, null);
      return;
    }
    callback(null, results);
  });
}

// 主程式
const dbConnection = connectdb();

// 測試更新資料
const dataset = ["Overview", "王曉明", "LGE-9955"]; // 表名、車主名稱、車牌號
updatedata(dataset, dbConnection, (err, results) => {
  if (err) {
    console.error("更新資料失敗：", err.message);
    dbConnection.end();
    return;
  }
  console.log("更新成功：", results);

  // 查詢資料
  dbConnection.query("SELECT * FROM Overview", (err, results, fields) => {
    if (err) {
      console.error("查詢資料失敗：", err.message);
    } else {
      console.log("查詢結果：", results);
    }

    // 關閉連線
    dbConnection.end((err) => {
      if (err) {
        console.error("關閉連線失敗：", err.message);
        return;
      }
      console.log("成功關閉資料庫連線。");
    });
  });
});
