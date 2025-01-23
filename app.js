const express = require("express");
const { engine } = require("express-handlebars");
const bodyParser = require("body-parser");
const mysql = require("mysql2");

const app = express();

// 設置模板引擎
app.engine("hbs", engine({ extname: ".hbs", defaultLayout: "main" }));
app.set("view engine", "hbs");
app.set("views", "./views");

// 中間件
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static("public"));

// 資料庫連接設置
const db = mysql.createConnection({
  host: "ewk5w.h.filess.io",
  user: "noisecar_viewjobup",
  password: "6aa2d7447c0cdbaa95ecddb873841d21af9ee310",
  database: "noisecar_viewjobup",
  port: 3307,
});

db.connect((err) => {
  if (err) {
    console.error("資料庫連接失敗:", err);
    return;
  }
  console.log("已成功連接資料庫");
});

// 首頁路由
app.get("/", (req, res) => {
  res.render("index");
});

// 新增案件頁面路由
app.get("/add-case", (req, res) => {
  res.render("add_case");
});

// 處理新增案件的提交請求
app.post("/add-case", async (req, res) => {
  const { caseYear, caseMonth, issueDate, issueDept, issueNumber, vehicleNumbers } = req.body;
  const caseMonthFull = `${caseYear}-${String(caseMonth).padStart(2, "0")}-01`;
  const vehicles = vehicleNumbers.split("\n").map((v) => v.trim()).filter((v) => v);

  const casesData = [];
  const sourceCaseVehicleLinksData = [];
  const caseSourceLinksData = [];

  try {
    // 查詢車主名稱並填充數據
    for (const vehicle of vehicles) {
      const registrySql = `
        SELECT owner_name FROM bike_registry WHERE query_number = ?
        UNION
        SELECT owner_name FROM car_registry WHERE query_number = ?
      `;

      const [results] = await db.promise().query(registrySql, [vehicle, vehicle]);
      const owner_name = results[0] ? results[0].owner_name : "未知";

      casesData.push([vehicle, owner_name, caseMonthFull]);
      sourceCaseVehicleLinksData.push([issueNumber, vehicle]);
    }

    // 如果沒有有效數據，則返回錯誤
    if (casesData.length === 0) {
      return res.status(400).json({ message: "無有效案件數據，請檢查輸入！" });
    }

    // 插入 cases 表
    const casesSql = "INSERT IGNORE INTO cases (vehicle_number, owner_name, case_month) VALUES ?";
    await db.promise().query(casesSql, [casesData]);

    // 插入 source_case 表
    const sourceCaseSql = "INSERT IGNORE INTO source_case (issue_date, issue_dept, issue_number) VALUES ?";
    await db.promise().query(sourceCaseSql, [[[issueDate, issueDept, issueNumber]]]);

    // 插入 source_case_vehicle_links 表
    const sourceCaseVehicleLinksSql =
      "INSERT IGNORE INTO source_case_vehicle_links (issue_number, vehicle_number) VALUES ?";
    await db.promise().query(sourceCaseVehicleLinksSql, [sourceCaseVehicleLinksData]);

    // 查詢插入的 cases 與 source_case 關聯數據
    const caseSourceQuery = `
      SELECT c.id AS case_id, sc.issue_number
      FROM cases c
      JOIN source_case_vehicle_links scvl ON c.vehicle_number = scvl.vehicle_number
      JOIN source_case sc ON scvl.issue_number = sc.issue_number
      WHERE c.vehicle_number IN (?) AND sc.issue_number = ?;
    `;
    const [caseSourceResults] = await db.promise().query(caseSourceQuery, [vehicles, issueNumber]);

    // 構建 case_source_links 表插入數據
    caseSourceResults.forEach(({ case_id, issue_number }) => {
      caseSourceLinksData.push([case_id, issue_number]);
    });

    if (caseSourceLinksData.length > 0) {
      const caseSourceLinksSql = "INSERT IGNORE INTO case_source_links (case_id, issue_number) VALUES ?";
      await db.promise().query(caseSourceLinksSql, [caseSourceLinksData]);
    }

    // 返回成功響應
    res.json({ message: "案件已成功新增並關聯！" });
  } catch (err) {
    console.error("操作失敗：", err);
    res.status(500).json({ message: "新增案件失敗，請檢查伺服器日誌！" });
  }
});



// 啟動伺服器
app.listen(3000, () => {
  console.log("伺服器已啟動：http://localhost:3000");
});
