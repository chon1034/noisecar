// 引入 MySQL 連接套件
const mysql = require('mysql'); 

// 資料庫連線設定
const dbConfig = {
    host: 'ewk5w.h.filess.io',       // 資料庫主機的 IP 或主機名稱
    user: 'noisecar_viewjobup',            // 資料庫帳號
    password: '6aa2d7447c0cdbaa95ecddb873841d21af9ee310',     // 資料庫密碼
    database: 'noisecar_viewjobup'        // 資料庫名稱
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
    dbConnection.query('UPDATE ?? SET Name = ? WHERE ID = ?', dataset, function(err, results){
        if(err){
            throw err;
        }
        console.log(results);
    });
    dbConnection.end();
};

d=['City','AW',1]
conn1=connectdb()
updatedata(d,conn1)


// 測試查詢功能
dbConnection.query('SELECT * FROM city where id = 1 LIMIT 5', (err, results, fields) => {
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
