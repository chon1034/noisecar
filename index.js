const mysql = require("mysql");

const hostname = "ewk5w.h.filess.io";
const database = "noisecar_viewjobup";
const port = "3307";
const username = "noisecar_viewjobup";
const password = "6aa2d7447c0cdbaa95ecddb873841d21af9ee310";

const conn = {
  host: hostname,
  user: username,
  password,
  database,
  port,
};

// 定義連線資料庫的函數
function connectdb() {
    // 建立資料庫連線
    const connection = mysql.createConnection(dbConfig);

    // 嘗試連線並處理連線錯誤
    connection.connect((err) => {
        if (err) {
            console.error('資料庫連線失敗：', err.message);
            return;
        }
        console.log('成功連線到資料庫！');
    });

    return connection; // 回傳連線實例供後續操作
}

// 呼叫函數進行測試
const dbConnection = connectdb();


function updatedata(dataset, dbConnection){
    dbConnection.query('UPDATE ?? SET CarNumber = ? CarOwner ID = ?', dataset, function(err, results){
        if(err){
            throw err;
        }
        console.log(results);
    });
    dbConnection.end();
};

d=['LGE-9955','王曉明']
conn1=connectdb()
updatedata.(d,conn1)

// 測試查詢功能
dbConnection.query('SELECT * FROM Overview ', (err, results, fields) => {
    if (err) {
        console.error('資料查詢失敗：', err.message);
        return;
    }
    console.log('查詢結果：', results);
});


// 關閉連線
dbConnection.end((err) => {
    if (err) {
        console.error('關閉連線失敗：', err.message);
        return;
    }
    console.log('成功關閉資料庫連線。');
});