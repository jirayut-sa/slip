/**
 * SEC1 v3 ไก่จิก — รัน setupChickenGame() เมื่ออัปเกรด และอ่าน SETUP.md
 * 1) สำรอง Google Sheets เดิมก่อนเปลี่ยนเวอร์ชัน (ยอดเก่ายังคงเดิม)
 * 2) Script Properties: SHEET_ID, DRIVE_FOLDER_ID, LINE_CHANNEL_ACCESS_TOKEN,
 *    LINE_GROUP_ID, LINE_ADMIN_USER_IDS=Uคนแรก,Uคนที่สอง,
 *    LINE_LOGIN_CHANNEL_ID=เลข Channel ของ LINE Login ที่สร้าง LIFF,
 *    LIFF_ID=2011470307-gvcrsOhk, BANK_NAME, BANK_ACCOUNT_NO, BANK_ACCOUNT_NAME,
 *    PUBLIC_WEB_APP_URL=https://jirayut-sa.github.io/slip/liff.html,
 *    GEMINI_API_KEY (ไม่ตั้งก็กรอกข้อมูลสลิปเองได้),
 *    GEMINI_MODELS (optional: gemini-2.5-flash,gemini-2.5-flash-lite).
 * 3) รัน setupSec1V2() แล้ว setupMonthlyLineTrigger() ด้วยบัญชีเจ้าของชีต
 *    แชร์โฟลเดอร์ Drive เฉพาะ Google account ของ Admin ทั้งสอง เพื่อเปิดหลักฐานได้
 * 4) Deploy Web app เวอร์ชันใหม่: Execute as Me / Anyone.
 *    ถ้าได้ URL /exec ใหม่ ให้แก้ apiUrl ใน config.js
 * 5) LINE webhook = URL /exec?key=ค่า LINE_WEBHOOK_KEY จาก Script Properties.
 *    เก็บ URL นี้เป็นความลับ: query secret ไม่ใช่การตรวจ X-Line-Signature.
 *    Apps Script ไม่เปิด request headers ให้ตรวจ; ถ้าต้องการยืนยันลายเซ็น LINE
 *    ต้องวาง gateway ที่ตรวจ HMAC ก่อนส่งต่อมายัง URL ลับนี้.
 * 6) LIFF Endpoint URL=https://jirayut-sa.github.io/slip/liff.html และเปิด scope profile.
 *    Rich Menu ทุกช่องต้องเป็น Link: https://liff.line.me/2011470307-gvcrsOhk?view=...
 *    view: create-bill,my-bills,open-bills,summary,expenses; admin เพิ่ม
 *    create-withdrawal,plans,reviews,notifications.
 * 7) รัน diagnoseDailyReminder() เพื่อตรวจแบบไม่ส่งข้อความ;
 *    testDailyReminderNow() ส่งข้อความจริง เฉพาะเมื่อพร้อมทดสอบ.
 *    รอบหลักประมาณ 12:00 รอบสำรองประมาณ 12:30 Asia/Bangkok (คลาดเคลื่อน ±15 นาที).
 *    รายเดือนทวง 23–28 กิจกรรมทุกวันเฉพาะผู้ค้าง; LINE accepted ไม่ยืนยันการส่งถึงเครื่อง.
 * 8) OCR ช่วยอ่าน ไม่ยืนยันสลิปแท้/เงินเข้า และไม่มีการเชื่อม K PLUS อัตโนมัติ.
 *    Admin ตรวจยอดเข้าธนาคารและเลขอ้างอิงก่อนอนุมัติ จึงเพิ่มยอดรับ.
 * 9) Cache เฉพาะผลยืนยัน LINE สูงสุด 900 วินาที ใช้ SHA256 key ไม่เก็บ raw token.
 *    ทุกเมนูอ่านการเงินจาก Sheets ใหม่; อย่าแก้ชีตพร้อมรายการที่กำลังลงบัญชี.
 * 10) สำหรับบัญชี LINE ที่ sync ทั้งกลุ่มได้ 403 สมาชิกพิมพ์ เมนู ในกลุ่ม
 *     เพื่อผูกบัญชีทีละคน; ต้องเป็นเพื่อน OA เพื่อรับข้อความส่วนตัวตามเงื่อนไข LINE.
 * 11) หาก RequestLedger ไม่มี result หลังงานสะดุด ให้ Admin ตรวจชีต/ไฟล์ก่อน
 *     แก้สถานะ ห้ามลบคำขอค้างแล้วส่งซ้ำโดยไม่ตรวจยอดเดิม.
 * 12) Strict menu-only patch: รับคำสั่งข้อความเฉพาะ เมนู / sec1 เท่านั้น.
 *     คำสั่งข้อความเดิมทั้งหมดถูกปิด รวมถึง สรุป บิล รายชื่อสมาชิก ลงทะเบียน จ่าย เตือน ถอน.
 *     ทำรายการผ่านปุ่มเมนู/LIFF; การแจ้งเตือนทุกชุดแนบเมนู ไม่ต้องตั้ง Trigger ใหม่.
 */

const LINE_MENU_POLICY = 'strict-menu-only-v2';
const LINE_MENU_ALT_TEXT = 'SEC1 • ไก่จิกทวงตัง';

// Flash อ่านรอบแรกเพื่อความเร็ว, Pro ตรวจซ้ำเมื่อคุณภาพต่ำ/ยอดสูง, Lite เป็นระบบสำรอง
const GEMINI_MODEL_FALLBACKS = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite'
];
const OCR_PRO_MODEL = 'gemini-2.5-pro';
const OCR_DEFAULT_QUALITY_THRESHOLD = 80;
const OCR_DEFAULT_PRO_VERIFY_AMOUNT = 5000;
const OCR_LAST_GOOD_MODEL_CACHE_KEY = 'OCR_LAST_GOOD_MODEL_V2';
const OCR_LAST_GOOD_MODEL_TTL_SECONDS = 21600; // 6 ชั่วโมง
const OCR_NOT_FOUND_COOLDOWN_SECONDS = 21600;  // โมเดลใช้ไม่ได้: พัก 6 ชั่วโมง
const OCR_RATE_LIMIT_COOLDOWN_SECONDS = 60;    // โควตาเฉพาะโมเดล: พัก 1 นาที
const OCR_SERVER_COOLDOWN_SECONDS = 15;        // ระบบชั่วคราว: พัก 15 วินาที
const OCR_TRANSIENT_RETRY_DELAY_MS = 350;

const SHEET_MEMBERS = 'Members';
const SHEET_TRANSACTIONS = 'Transactions';
const SHEET_SKIPPED_MONTHS = 'SkippedMonths';
const SHEET_ACTIVITIES = 'Activities';
const SHEET_BILLS = 'Bills';
const SHEET_BILL_MEMBERS = 'BillMembers';
const SHEET_MONTHLY_PLANS = 'MonthlyPlans';
const SHEET_WITHDRAWALS = 'Withdrawals';
const LOCK_WAIT_MS = 30000;
const APP_TIMEZONE = 'Asia/Bangkok';
// ข้อมูลการเงินต้องอ่านจากชีตล่าสุดทุกครั้ง จึงไม่ Cache payload ของเมนู
const LIFF_PROFILE_CACHE_TTL_SECONDS = 900; // 15 นาที — Cache เฉพาะผลตรวจตัวตน LINE
const LIFF_PENDING_SLIP_TTL_SECONDS = 1200;
const LIFF_PAGE_SIZE = 10;

const MEMBER_HEADERS = ['id', 'name', 'lineUserId', 'lineDisplayName', 'pictureUrl', 'status', 'sourceGroupId', 'createdAt', 'updatedAt'];
const TRANSACTION_HEADERS = [
  'id', 'type', 'memberName', 'amount', 'date', 'note', 'ocrSenderName',
  'slipUrl', 'createdAt', 'ocrSenderBank', 'ocrBankApp', 'ocrReferenceNo',
  'nameMatchStatus', 'clientRequestId', 'slipOwnerName', 'activityId', 'billId', 'memberId'
];
const SKIPPED_MONTH_HEADERS = ['id', 'monthKey', 'note', 'createdAt'];
const ACTIVITY_HEADERS = ['id', 'name', 'targetAmount', 'status', 'createdAt'];
const BILL_HEADERS = ['id', 'title', 'billType', 'monthKey', 'dueDate', 'totalExpected', 'status', 'note', 'createdBy', 'createdAt'];
const BILL_MEMBER_HEADERS = ['id', 'billId', 'memberId', 'memberName', 'lineUserId', 'amount', 'paidAmount', 'status', 'transactionId', 'paidAt', 'remindedAt'];
const MONTHLY_PLAN_HEADERS = ['id', 'title', 'amountPerMember', 'billingDay', 'dueDay', 'memberIds', 'status', 'lastGeneratedMonth', 'note', 'createdAt'];
const WITHDRAWAL_HEADERS = ['id', 'amount', 'date', 'purpose', 'withdrawnBy', 'proofUrl', 'createdAt'];

// ต้องตรงกับ MONTHLY_DEPOSIT_TARGET ใน index.html
const MONTHLY_DEPOSIT_TARGET = 7500;
const LINE_MESSAGING_PUSH_URL = 'https://api.line.me/v2/bot/message/push';

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const config = {
    sheetId: properties.getProperty('SHEET_ID') || '',
    driveFolderId: properties.getProperty('DRIVE_FOLDER_ID') || '',
    apiToken: properties.getProperty('API_TOKEN') || '',
    geminiApiKey: properties.getProperty('GEMINI_API_KEY') || '',
    geminiModels: properties.getProperty('GEMINI_MODELS') || '',
    ocrQualityThreshold: Number(properties.getProperty('OCR_QUALITY_THRESHOLD')) || OCR_DEFAULT_QUALITY_THRESHOLD,
    ocrProVerifyAmount: Number(properties.getProperty('OCR_PRO_VERIFY_AMOUNT')) || OCR_DEFAULT_PRO_VERIFY_AMOUNT,
    lineChannelAccessToken: properties.getProperty('LINE_CHANNEL_ACCESS_TOKEN') || '',
    lineGroupId: properties.getProperty('LINE_GROUP_ID') || '',
    webAppUrl: properties.getProperty('PUBLIC_WEB_APP_URL') || '',
    liffId: properties.getProperty('LIFF_ID') || '2011470307-gvcrsOhk',
    lineAdminUserIds: properties.getProperty('LINE_ADMIN_USER_IDS') || '',
    bankName: properties.getProperty('BANK_NAME') || 'ธนาคารกรุงไทย',
    bankAccountNo: properties.getProperty('BANK_ACCOUNT_NO') || '9020878972',
    bankAccountName: properties.getProperty('BANK_ACCOUNT_NAME') || 'นางสุวดี หีมปอง'
  };
  if (!config.sheetId) throw new Error('ยังไม่ได้ตั้งค่า Script Property: SHEET_ID');
  if (!config.driveFolderId) throw new Error('ยังไม่ได้ตั้งค่า Script Property: DRIVE_FOLDER_ID');
  // SEC1 v2 authenticates using LINE; legacy API_TOKEN is not exposed or required.
  return config;
}

function setupSystem() {
  return withScriptLock_(function () {
    ensureHeaders_(getSheet_(SHEET_MEMBERS), MEMBER_HEADERS);
    ensureHeaders_(getSheet_(SHEET_TRANSACTIONS), TRANSACTION_HEADERS);
    ensureHeaders_(getSheet_(SHEET_SKIPPED_MONTHS), SKIPPED_MONTH_HEADERS);
    ensureHeaders_(getSheet_(SHEET_ACTIVITIES), ACTIVITY_HEADERS);
    ensureHeaders_(getSheet_(SHEET_BILLS), BILL_HEADERS);
    ensureHeaders_(getSheet_(SHEET_BILL_MEMBERS), BILL_MEMBER_HEADERS);
    ensureHeaders_(getSheet_(SHEET_MONTHLY_PLANS), MONTHLY_PLAN_HEADERS);
    ensureHeaders_(getSheet_(SHEET_WITHDRAWALS), WITHDRAWAL_HEADERS);
    Logger.log('ตั้งค่าระบบสำเร็จ');
    return { success: true };
  });
}

function testPermission() {
  UrlFetchApp.fetch('https://www.google.com');
  Logger.log('ได้รับสิทธิ์ UrlFetchApp เรียบร้อยแล้ว');
}

function doPost(e) {
  try {
    const b=JSON.parse(e && e.postData ? e.postData.contents : '{}');
    if(b.events){
      const secret=PropertiesService.getScriptProperties().getProperty('LINE_WEBHOOK_KEY');
      if(!secret || !e.parameter || e.parameter.key!==secret) return jsonOutput_({success:false,message:'Webhook key required'});
      return handleLineWebhook_(b);
    }
    return jsonOutput_(secDispatch_(b));
  } catch(err){return jsonOutput_({success:false,message:err.message});}
}

function doGet(e) { return jsonOutput_({success:true,app:'SEC1',version:'3.0-chicken',menuPolicy:LINE_MENU_POLICY,message:'Use authenticated POST API'}); }

function dispatchAction_(body) {
  switch (body.action) {
    case 'getData': return getData_();
    case 'getLiffSession': return getLiffSession_(body.liffAccessToken);
    case 'getLiffViewData': return getLiffViewData_(body);
    case 'createLiffBill': return createLiffBill_(body);
    case 'createLiffWithdrawal': return createLiffWithdrawal_(body);
    case 'uploadLiffSlip': return uploadLiffSlip_(body);
    case 'confirmLiffSlip': return confirmLiffSlip_(body);
    case 'addMember': return addMember_(body.name);
    case 'deleteMember': return deleteMember_(body.id);
    case 'ocrSlip': return ocrSlip_(body.imageBase64, body.mimeType);
    case 'confirmTransaction': return confirmTransaction_(body);
    case 'deleteTransaction': return deleteTransaction_(body.id);
    case 'skipMonth': return skipMonth_(body.monthKey, body.note);
    case 'unskipMonth': return unskipMonth_(body.monthKey);
    case 'addActivity': return addActivity_(body.name, body.targetAmount);
    case 'deleteActivity': return deleteActivity_(body.id);
    case 'createBill': return createBill_(body);
    case 'closeBill': return closeBill_(body.id);
    case 'sendBillReminder': return sendBillReminder_(body.id);
    case 'createMonthlyPlan': return createMonthlyPlan_(body);
    case 'deleteMonthlyPlan': return deleteMonthlyPlan_(body.id);
    case 'addWithdrawal': return addWithdrawal_(body);
    case 'deleteWithdrawal': return deleteWithdrawal_(body.id);
    default: return { success: false, message: 'ไม่รู้จัก action: ' + body.action };
  }
}

function withScriptLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(LOCK_WAIT_MS);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function jsonOutput_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ================== Sheet helpers ==================
let REQUEST_SPREADSHEET_ = null;
function getSpreadsheet_() {
  if (!REQUEST_SPREADSHEET_) REQUEST_SPREADSHEET_ = SpreadsheetApp.openById(getConfig_().sheetId);
  return REQUEST_SPREADSHEET_;
}

function getHeadersForSheetName_(name) {
  switch (name) {
    case SHEET_MEMBERS: return MEMBER_HEADERS;
    case SHEET_TRANSACTIONS: return TRANSACTION_HEADERS;
    case SHEET_SKIPPED_MONTHS: return SKIPPED_MONTH_HEADERS;
    case SHEET_ACTIVITIES: return ACTIVITY_HEADERS;
    case SHEET_BILLS: return BILL_HEADERS;
    case SHEET_BILL_MEMBERS: return BILL_MEMBER_HEADERS;
    case SHEET_MONTHLY_PLANS: return MONTHLY_PLAN_HEADERS;
    case SHEET_WITHDRAWALS: return WITHDRAWAL_HEADERS;
    case "PaymentReviews": return SEC_SLIPS;
    case "NotificationLog": return SEC_LOG;
    case "RequestLedger": return SEC_REQUEST;
    case "GameLedger": return GAME_LEDGER;
    case "GameProfiles": return GAME_PROFILE;
    case "GameSeasons": return GAME_SEASON;
    default: return [];
  }
}

function getSheet_(name) {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.appendRow(getHeadersForSheetName_(name));
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureHeaders_(sheet, requiredHeaders) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (sheet.getLastRow() === 0 || headers.every(function (header) { return !header; })) {
    headers = [];
  }
  let changed = false;
  requiredHeaders.forEach(function (header) {
    if (headers.indexOf(header) === -1) {
      headers.push(header);
      changed = true;
    }
  });
  if (changed || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return headers;
}

function appendRowByHeaders_(sheet, headers, rowObject) {
  sheet.appendRow(headers.map(function (header) {
    return rowObject[header] !== undefined && rowObject[header] !== null
      ? rowObject[header]
      : '';
  }));
}

function sheetToObjects_(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1).map(function (row) {
    const object = {};
    headers.forEach(function (header, index) { object[header] = row[index]; });
    return object;
  }).filter(function (row) { return row.id; });
}

function findObjectByField_(sheet, fieldName, value) {
  if (!value || sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  const fieldIndex = headers.indexOf(fieldName);
  if (fieldIndex === -1) return null;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let index = 0; index < values.length; index++) {
    if (String(values[index][fieldIndex]) === String(value)) {
      const object = {};
      headers.forEach(function (header, columnIndex) { object[header] = values[index][columnIndex]; });
      return { row: index + 2, object: object, headers: headers };
    }
  }
  return null;
}

// ================== Actions ==================
function getData_() {
  const members = sheetToObjects_(getSheet_(SHEET_MEMBERS)).map(function (member) {
    return {
      id: member.id,
      name: member.name,
      lineUserId: member.lineUserId || '',
      lineDisplayName: member.lineDisplayName || '',
      pictureUrl: member.pictureUrl || '',
      status: member.status || 'active',
      createdAt: formatDateValue_(member.createdAt)
    };
  });

  const transactions = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)).map(function (transaction) {
    return {
      id: transaction.id,
      type: transaction.type,
      memberName: transaction.memberName,
      amount: transaction.amount,
      date: formatDateValue_(transaction.date),
      note: transaction.note,
      ocrSenderName: transaction.ocrSenderName,
      slipUrl: transaction.slipUrl,
      createdAt: formatDateValue_(transaction.createdAt),
      ocrSenderBank: transaction.ocrSenderBank || '',
      ocrBankApp: transaction.ocrBankApp || '',
      ocrReferenceNo: transaction.ocrReferenceNo || '',
      nameMatchStatus: transaction.nameMatchStatus || '',
      clientRequestId: transaction.clientRequestId || '',
      activityId: transaction.activityId || '',
      billId: transaction.billId || ''
    };
  });

  const skippedMonths = sheetToObjects_(getSheet_(SHEET_SKIPPED_MONTHS)).map(function (row) {
    return {
      id: row.id,
      monthKey: row.monthKey,
      note: row.note || '',
      createdAt: formatDateValue_(row.createdAt)
    };
  });

  const activities = sheetToObjects_(getSheet_(SHEET_ACTIVITIES)).map(function (row) {
    return {
      id: row.id,
      name: row.name,
      targetAmount: Number(row.targetAmount) || 0,
      status: row.status || 'active',
      createdAt: formatDateValue_(row.createdAt)
    };
  });

  const bills = sheetToObjects_(getSheet_(SHEET_BILLS)).map(function (row) {
    return Object.assign({}, row, {
      totalExpected: Number(row.totalExpected) || 0,
      dueDate: formatDateValue_(row.dueDate), createdAt: formatDateValue_(row.createdAt)
    });
  });
  const billMembers = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).map(function (row) {
    return Object.assign({}, row, {
      amount: Number(row.amount) || 0,
      paidAmount: Number(row.paidAmount) || 0,
      paidAt: formatDateValue_(row.paidAt), remindedAt: formatDateValue_(row.remindedAt)
    });
  });
  const monthlyPlans = sheetToObjects_(getSheet_(SHEET_MONTHLY_PLANS)).map(function (row) {
    return Object.assign({}, row, {
      amountPerMember: Number(row.amountPerMember) || 0,
      billingDay: Number(row.billingDay) || 1, dueDay: Number(row.dueDay) || 1
    });
  });
  const withdrawals = sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)).map(function (row) {
    return Object.assign({}, row, {
      amount: Number(row.amount) || 0,
      date: formatDateValue_(row.date), createdAt: formatDateValue_(row.createdAt)
    });
  });

  return {
    success: true,
    members: members,
    transactions: transactions,
    skippedMonths: skippedMonths,
    activities: activities,
    bills: bills,
    billMembers: billMembers,
    monthlyPlans: monthlyPlans,
    withdrawals: withdrawals,
    financeSummary: buildFinanceSummary_(transactions, withdrawals, bills, billMembers),
    publicConfig: {
      liffId: getConfig_().liffId,
      bankName: getConfig_().bankName,
      bankAccountNo: getConfig_().bankAccountNo,
      bankAccountName: getConfig_().bankAccountName
    }
  };
}

function formatDateValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value || '';
}

function addMember_(name) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { success: false, message: 'กรุณาระบุชื่อสมาชิก' };
  const sheet = getSheet_(SHEET_MEMBERS);
  ensureHeaders_(sheet, MEMBER_HEADERS);

  const duplicate = sheetToObjects_(sheet).some(function (member) {
    return String(member.name || '').trim() === cleanName;
  });
  if (duplicate) return { success: false, message: 'มีสมาชิกชื่อนี้อยู่แล้ว' };

  const id = 'm_' + Utilities.getUuid();
  appendRowByHeaders_(sheet, MEMBER_HEADERS, {
    id: id,
    name: cleanName,
    lineUserId: '',
    lineDisplayName: '',
    pictureUrl: '',
    status: 'active',
    sourceGroupId: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  return { success: true, id: id };
}

function deleteMember_(id) {
  const sheet = getSheet_(SHEET_MEMBERS);
  const found = findObjectByField_(sheet, 'id', id);
  if (!found) return { success: false, message: 'ไม่พบสมาชิกที่ต้องการลบ' };
  sheet.deleteRow(found.row);
  return { success: true };
}

function deleteTransaction_(id) {
  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const found = findObjectByField_(sheet, 'id', id);
  if (!found) return { success: false, message: 'ไม่พบรายการที่ต้องการลบ' };

  const slipUrl = found.object.slipUrl;
  if (slipUrl) {
    try {
      const fileId = extractDriveFileId_(slipUrl);
      if (fileId) DriveApp.getFileById(fileId).setTrashed(true);
    } catch (err) {
      // การลบแถวต้องทำต่อ แม้ไฟล์ใน Drive ถูกลบไม่ได้
    }
  }
  sheet.deleteRow(found.row);
  return { success: true };
}

function extractDriveFileId_(url) {
  const match = String(url || '').match(/[-\w]{25,}/);
  return match ? match[0] : null;
}

function confirmTransaction_(body) {
  const type = body.type === 'expense' ? 'expense' : 'deposit';
  const memberName = String(body.memberName || '').trim();
  const amount = Number(body.amount);
  const clientRequestId = String(body.clientRequestId || '').trim().slice(0, 200);
  const slipOwnerName = String(body.slipOwnerName || memberName).trim();
  const activityId = String(body.activityId || '').trim();
  const billId = String(body.billId || '').trim();

  if (!memberName || !Number.isFinite(amount) || amount <= 0) {
    return { success: false, message: 'ข้อมูลไม่ครบถ้วน (ต้องมีชื่อสมาชิกและจำนวนเงิน)' };
  }
  if (slipOwnerName !== memberName) {
    return { success: false, message: 'ชื่อสมาชิกไม่ตรงกับสลิป กรุณาแนบสลิปใหม่' };
  }
  if (activityId && !findObjectByField_(getSheet_(SHEET_ACTIVITIES), 'id', activityId)) {
    return { success: false, message: 'ไม่พบกิจกรรมที่ระบุ' };
  }

  const sheet = getSheet_(SHEET_TRANSACTIONS);
  const headers = ensureHeaders_(sheet, TRANSACTION_HEADERS);

  // Idempotency: คำขอเดิมที่ถูกส่งซ้ำจะได้ผลลัพธ์เดิม ไม่สร้างแถวหรือไฟล์ซ้ำ
  if (clientRequestId) {
    const existing = findObjectByField_(sheet, 'clientRequestId', clientRequestId);
    if (existing) {
      return {
        success: true,
        duplicate: true,
        id: existing.object.id,
        slipUrl: existing.object.slipUrl || ''
      };
    }
  }

  const transactionId = 't_' + Utilities.getUuid();
  const requestId = clientRequestId || 'legacy_' + Utilities.getUuid();
  // _savedSlipUrl ใช้ภายในจาก flow LIFF เท่านั้น หลังบันทึกรูปไป Drive แล้วหนึ่งครั้ง
  let slipUrl = String(body._savedSlipUrl || '').trim();
  let createdFile = null;

  try {
    if (!slipUrl && body.imageBase64) {
      const config = getConfig_();
      const folder = DriveApp.getFolderById(config.driveFolderId);
      const safeName = memberName.replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, '_').slice(0, 80);
      const fileName = 'slip_' + safeName + '_' + transactionId + '.jpg';
      const decoded = Utilities.base64Decode(String(body.imageBase64).split(',').pop());
      const blob = Utilities.newBlob(decoded, body.mimeType || 'image/jpeg', fileName);
      createdFile = folder.createFile(blob);
      // เก็บสลิปเป็นไฟล์ส่วนตัวตามสิทธิ์ของโฟลเดอร์ ห้ามเปิดเป็นสาธารณะ
      slipUrl = createdFile.getUrl();
    }

    const signedAmount = type === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    const transactionDate = body.date ? new Date(body.date).toISOString() : new Date().toISOString();
    appendRowByHeaders_(sheet, headers, {
      id: transactionId,
      type: type,
      memberName: memberName,
      amount: signedAmount,
      date: transactionDate,
      note: body.note || '',
      ocrSenderName: body.ocrSenderName || '',
      slipUrl: slipUrl,
      createdAt: new Date().toISOString(),
      ocrSenderBank: body.ocrSenderBank || '',
      ocrBankApp: body.ocrBankApp || '',
      ocrReferenceNo: body.ocrReferenceNo || '',
      nameMatchStatus: body.nameMatchStatus || '',
      clientRequestId: requestId,
      slipOwnerName: slipOwnerName,
      activityId: activityId
      ,billId: billId
    });

    if (billId && type === 'deposit') {
      markBillMemberPaid_(billId, memberName, transactionId, amount);
    }
  } catch (err) {
    // ป้องกันไฟล์กำพร้า หากสร้างไฟล์แล้วแต่เขียนชีตไม่สำเร็จ
    if (createdFile) {
      try { createdFile.setTrashed(true); } catch (cleanupError) {}
    }
    throw err;
  }

  return { success: true, id: transactionId, slipUrl: slipUrl };
}

// ================== Skip Month ==================
function normalizeMonthKey_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  return match ? match[0] : '';
}

function skipMonth_(monthKey, note) {
  const cleanMonth = normalizeMonthKey_(monthKey);
  if (!cleanMonth) return { success: false, message: 'รูปแบบเดือนไม่ถูกต้อง (ต้องเป็น YYYY-MM)' };

  const sheet = getSheet_(SHEET_SKIPPED_MONTHS);
  ensureHeaders_(sheet, SKIPPED_MONTH_HEADERS);

  const existing = findObjectByField_(sheet, 'monthKey', cleanMonth);
  if (existing) return { success: true, duplicate: true, id: existing.object.id };

  const id = 'sk_' + Utilities.getUuid();
  appendRowByHeaders_(sheet, SKIPPED_MONTH_HEADERS, {
    id: id,
    monthKey: cleanMonth,
    note: String(note || ''),
    createdAt: new Date().toISOString()
  });
  return { success: true, id: id };
}

function unskipMonth_(monthKey) {
  const cleanMonth = normalizeMonthKey_(monthKey);
  const sheet = getSheet_(SHEET_SKIPPED_MONTHS);
  const found = findObjectByField_(sheet, 'monthKey', cleanMonth);
  if (!found) return { success: false, message: 'ไม่พบเดือนนี้ในรายการที่ข้าม' };
  sheet.deleteRow(found.row);
  return { success: true };
}

// ================== Activities ==================
function addActivity_(name, targetAmount) {
  const cleanName = String(name || '').trim();
  if (!cleanName) return { success: false, message: 'กรุณาระบุชื่อกิจกรรม' };
  const sheet = getSheet_(SHEET_ACTIVITIES);
  ensureHeaders_(sheet, ACTIVITY_HEADERS);

  const duplicate = sheetToObjects_(sheet).some(function (activity) {
    return String(activity.name || '').trim() === cleanName && activity.status !== 'closed';
  });
  if (duplicate) return { success: false, message: 'มีกิจกรรมนี้อยู่แล้ว' };

  const id = 'act_' + Utilities.getUuid();
  const cleanTarget = Number(targetAmount) || 0;
  appendRowByHeaders_(sheet, ACTIVITY_HEADERS, {
    id: id,
    name: cleanName,
    targetAmount: cleanTarget,
    status: 'active',
    createdAt: new Date().toISOString()
  });

  // แจ้งเตือนกลุ่มไลน์ทันทีที่สร้างกิจกรรมใหม่ (ไม่กระทบผลลัพธ์ แม้แจ้งเตือนล้มเหลว)
  sendLineMessage_(buildActivityAnnouncementMessage_(cleanName, cleanTarget));

  return { success: true, id: id };
}

function deleteActivity_(id) {
  const sheet = getSheet_(SHEET_ACTIVITIES);
  const found = findObjectByField_(sheet, 'id', id);
  if (!found) return { success: false, message: 'ไม่พบกิจกรรมที่ต้องการลบ' };

  const hasTransactions = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)).some(function (t) {
    return String(t.activityId || '') === String(id);
  });
  if (hasTransactions) {
    return { success: false, message: 'ไม่สามารถลบได้ เนื่องจากมีรายการโอนผูกกับกิจกรรมนี้แล้ว' };
  }

  sheet.deleteRow(found.row);
  return { success: true };
}

// ================== Bills / monthly collection ==================
function cleanIds_(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
}

function getSelectedMembers_(memberIds) {
  const members = getActiveLineMembers_();
  const ids = cleanIds_(memberIds);
  return ids.length ? members.filter(function (m) { return ids.indexOf(String(m.id)) !== -1; }) : members;
}

function createBill_(body) {
  const title = String(body.title || '').trim();
  const amountPerMember = Number(body.amountPerMember);
  const billType = body.billType === 'monthly' ? 'monthly' : 'activity';
  const members = getSelectedMembers_(body.memberIds);
  if (!title) return { success: false, message: 'กรุณาระบุชื่อบิลหรือกิจกรรม' };
  if (!Number.isFinite(amountPerMember) || amountPerMember <= 0) return { success: false, message: 'ยอดต่อคนต้องมากกว่า 0' };
  if (!members.length) return { success: false, message: 'กรุณาเพิ่มหรือเลือกสมาชิกอย่างน้อย 1 คน' };

  const billId = body._billId || ('bill_' + Utilities.getUuid());
  const monthKey = normalizeMonthKeyServer_(body.monthKey) || getCurrentMonthKeyServer_();
  const dueDate = body.dueDate ? new Date(body.dueDate) : new Date();
  if (isNaN(dueDate.getTime())) return { success: false, message: 'วันครบกำหนดไม่ถูกต้อง' };
  const now = new Date().toISOString();
  if (!findObjectByField_(getSheet_(SHEET_BILLS), 'id', billId)) appendRowByHeaders_(getSheet_(SHEET_BILLS), BILL_HEADERS, {
    id: billId, title: title, billType: billType, monthKey: monthKey,
    dueDate: dueDate.toISOString(), totalExpected: amountPerMember * members.length,
    status: 'building', note: String(body.note || ''), createdBy: String(body.createdBy || 'admin'), createdAt: now
  });
  const memberSheet = getSheet_(SHEET_BILL_MEMBERS);
  members.forEach(function (member) {
    if(sheetToObjects_(memberSheet).some(r=>String(r.billId)===String(billId)&&String(r.memberId)===String(member.id)))return;
    appendRowByHeaders_(memberSheet, BILL_MEMBER_HEADERS, {
      id: 'bm_' + Utilities.getUuid(), billId: billId, memberId: member.id,
      memberName: member.name, lineUserId: member.lineUserId || '', amount: amountPerMember,
      paidAmount: 0,
      status: 'unpaid', transactionId: '', paidAt: '', remindedAt: ''
    });
  });
  updateObjectField_(getSheet_(SHEET_BILLS), 'id', billId, {status:'open'});
  sendBillCreatedNotifications_(billId);
  return { success: true, id: billId };
}

function markBillMemberPaid_(billId, memberName, transactionId, paidAmount) {
  const sheet = getSheet_(SHEET_BILL_MEMBERS);
  const rows = sheetToObjects_(sheet);
  const target = rows.find(function (row) {
    return String(row.billId) === String(billId) &&
      String(row.memberName || '').trim() === String(memberName || '').trim() && row.status !== 'paid';
  });
  if (!target) return;
  const found = findObjectByField_(sheet, 'id', target.id);
  if (!found) return;
  const cumulativePaid = Number(target.paidAmount || 0) + Number(paidAmount || 0);
  const isFullyPaid = cumulativePaid >= Number(target.amount || 0);
  const values = found.headers.map(function (h) {
    if (h === 'status') return isFullyPaid ? 'paid' : 'partial';
    if (h === 'paidAmount') return cumulativePaid;
    if (h === 'transactionId') return transactionId;
    if (h === 'paidAt') return new Date().toISOString();
    return found.object[h] === undefined ? '' : found.object[h];
  });
  sheet.getRange(found.row, 1, 1, values.length).setValues([values]);
  if (isFullyPaid) refreshBillStatus_(billId);
}

function refreshBillStatus_(billId) {
  const members = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).filter(function (m) { return String(m.billId) === String(billId); });
  if (!members.length || members.some(function (m) { return m.status !== 'paid'; })) return;
  updateObjectField_(getSheet_(SHEET_BILLS), 'id', billId, { status: 'paid' });
}

function updateObjectField_(sheet, idField, id, changes) {
  const found = findObjectByField_(sheet, idField, id);
  if (!found) return false;
  const values = found.headers.map(function (h) {
    return Object.prototype.hasOwnProperty.call(changes, h) ? changes[h] : (found.object[h] === undefined ? '' : found.object[h]);
  });
  sheet.getRange(found.row, 1, 1, values.length).setValues([values]);
  return true;
}

function closeBill_(id) {
  if (!updateObjectField_(getSheet_(SHEET_BILLS), 'id', id, { status: 'closed' })) {
    return { success: false, message: 'ไม่พบบิล' };
  }
  return { success: true };
}

function buildBillMessage_(billId, reminder) {
  const billFound = findObjectByField_(getSheet_(SHEET_BILLS), 'id', billId);
  if (!billFound) return 'ไม่พบบิล';
  const bill = billFound.object;
  const members = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).filter(function (m) { return String(m.billId) === String(billId); });
  const unpaid = members.filter(function (m) { return m.status !== 'paid'; });
  const paid = members.length - unpaid.length;
  const config = getConfig_();
  const names = unpaid.map(function (m) {
    return '• ' + m.memberName + ' — ' + Math.max(0, Number(m.amount || 0) - Number(m.paidAmount || 0)).toLocaleString('th-TH') + ' บาท';
  }).join('\n');
  const detailsUrl = buildLiffMenuUrl_('my-bills') || config.webAppUrl;
  return (reminder ? '⏰ แจ้งเตือนค้างชำระ\n' : '🧾 บิลเรียกเก็บเงินใหม่\n') +
    'รายการ: ' + bill.title + '\nครบกำหนด: ' + String(formatDateValue_(bill.dueDate)).substring(0, 10) +
    '\nชำระแล้ว: ' + paid + '/' + members.length + ' คน\n\n' + (names || '✅ ชำระครบทุกคนแล้ว') +
    (detailsUrl ? '\n\nกดดูบิลและส่งสลิปจากเมนูด้านล่าง\n' + detailsUrl : '');
}

function buildMemberBillReminderMessage_(bill, memberRow, reminder) {
  const remaining = Math.max(0, Number(memberRow.amount || 0) - Number(memberRow.paidAmount || 0));
  const paymentUrl = buildLiffBillUrl_(bill.id);
  const myBillsUrl = buildLiffMenuUrl_('my-bills');
  const footer = [];
  if (paymentUrl) footer.push(lineUriButton_('เปิดบิลและส่งสลิป', paymentUrl, '#0D9488'));
  if (myBillsUrl) footer.push(lineUriButton_('ดูบิลของฉัน', myBillsUrl, '#2563EB'));
  return { type: 'flex', altText: (reminder ? 'แจ้งเตือนค้างชำระ ' : 'บิลเรียกเก็บเงินใหม่ ') + String(bill.title || ''), contents: {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: reminder ? '#B45309' : '#0B3B60', paddingAll: '18px', contents: [
      { type: 'text', text: reminder ? '⏰ แจ้งเตือนค้างชำระ' : '🧾 บิลเรียกเก็บเงินใหม่', color: '#FFFFFF', size: 'lg', weight: 'bold' }
    ] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: String(bill.title || 'บิลเรียกเก็บเงิน'), weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: 'สมาชิก: ' + String(memberRow.memberName || ''), size: 'sm', color: '#475569', wrap: true },
      { type: 'text', text: remaining.toLocaleString('th-TH') + ' บาท', size: 'xxl', weight: 'bold', color: '#D97706', margin: 'md' },
      { type: 'text', text: 'ครบกำหนด ' + String(formatDateValue_(bill.dueDate)).substring(0, 10), size: 'xs', color: '#64748B' }
    ] },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer }
  } };
}

function sendBillCreatedNotifications_(billId) {
  // บิลใหม่แสดงทันทีใน LIFF; แจ้งเตือนรอบเที่ยง หรือ Admin กดแจ้งเตือนผู้ค้างในบิล
}

function sendBillReminder_(id) { return secNotifyBill_(id); }

function createMonthlyPlan_(body) {
  const title = String(body.title || '').trim();
  const amount = Number(body.amountPerMember);
  const billingDay = 23;
  const dueDay = Math.min(28, Math.max(23, Number(body.dueDay) || 28));
  const members = getSelectedMembers_(body.memberIds);
  if (!title || !Number.isFinite(amount) || amount <= 0 || !members.length) return { success: false, message: 'ข้อมูลแผนรายเดือนไม่ครบถ้วน' };
  const id = 'plan_' + Utilities.getUuid();
  appendRowByHeaders_(getSheet_(SHEET_MONTHLY_PLANS), MONTHLY_PLAN_HEADERS, {
    id: id, title: title, amountPerMember: amount, billingDay: billingDay, dueDay: dueDay,
    memberIds: members.map(function (m) { return m.id; }).join(','), status: 'active',
    lastGeneratedMonth: '', note: String(body.note || ''), createdAt: new Date().toISOString()
  });
  generateMonthlyBills_();
  return { success: true, id: id };
}

function deleteMonthlyPlan_(id) {
  const sheet = getSheet_(SHEET_MONTHLY_PLANS);
  if (!updateObjectField_(sheet, 'id', id, { status: 'inactive' })) return { success: false, message: 'ไม่พบแผนรายเดือน' };
  return { success: true };
}

function generateMonthlyBills_() {
  const now = new Date();
  const monthKey = getCurrentMonthKeyServer_();
  const bangkokDay = getBangkokDayOfMonth_(now);
  if (bangkokDay < 23 || bangkokDay > 28) return;
  sheetToObjects_(getSheet_(SHEET_MONTHLY_PLANS)).filter(function (p) { return p.status === 'active'; }).forEach(function (plan) {
    if (String(plan.lastGeneratedMonth || '') === monthKey) return;
    const dueDay = String(Math.min(28, Number(plan.dueDay) || 1)).padStart(2, '0');
    const due = new Date(monthKey + '-' + dueDay + 'T12:00:00+07:00');
    const result = createBill_({ _billId: 'monthly_'+plan.id+'_'+monthKey, title: plan.title + ' ' + formatThaiMonthServer_(monthKey), amountPerMember: plan.amountPerMember,
      billType: 'monthly', monthKey: monthKey, dueDate: due.toISOString(), memberIds: cleanIds_(plan.memberIds), note: plan.note });
    if (result.success) updateObjectField_(getSheet_(SHEET_MONTHLY_PLANS), 'id', plan.id, { lastGeneratedMonth: monthKey });
  });
}

function addWithdrawal_(body) {
  const amount = Number(body.amount);
  const purpose = String(body.purpose || '').trim();
  if (!Number.isFinite(amount) || amount <= 0 || !purpose) return { success: false, message: 'กรุณาระบุยอดถอนและวัตถุประสงค์' };
  const summary = buildFinanceSummary_(sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)), sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)));
  if (amount > summary.balance) return { success: false, message: 'ยอดคงเหลือไม่เพียงพอ' };
  const id = 'wd_' + Utilities.getUuid();
  appendRowByHeaders_(getSheet_(SHEET_WITHDRAWALS), WITHDRAWAL_HEADERS, {
    id: id, amount: amount, date: body.date ? new Date(body.date).toISOString() : new Date().toISOString(),
    purpose: purpose, withdrawnBy: String(body.withdrawnBy || 'admin'), proofUrl: String(body.proofUrl || ''), createdAt: new Date().toISOString()
  });
  return { success: true, id: id };
}

function deleteWithdrawal_(id) {
  const sheet = getSheet_(SHEET_WITHDRAWALS);
  const found = findObjectByField_(sheet, 'id', id);
  if (!found) return { success: false, message: 'ไม่พบรายการถอน' };
  sheet.deleteRow(found.row);
  return { success: true };
}

function buildFinanceSummary_(transactions, withdrawals, bills, billMembers) {
  const income = (transactions || []).reduce(function (sum, t) { const a = Number(t.amount) || 0; return sum + (a > 0 ? a : 0); }, 0);
  const expenses = (transactions || []).reduce(function (sum, t) { const a = Number(t.amount) || 0; return sum + (a < 0 ? Math.abs(a) : 0); }, 0);
  const withdrawn = (withdrawals || []).reduce(function (sum, w) { return sum + (Number(w.amount) || 0); }, 0);
  const openBillIds = {};
  (bills || []).filter(function (b) { return b.status === 'open'; }).forEach(function (b) { openBillIds[String(b.id)] = true; });
  const restrictToOpen = (bills || []).length > 0;
  const expected = (billMembers || []).reduce(function (sum, m) {
    if (restrictToOpen && !openBillIds[String(m.billId)]) return sum;
    return sum + Math.max(0, (Number(m.amount) || 0) - (Number(m.paidAmount) || 0));
  }, 0);
  const round=n=>Math.round(n*100)/100;return { income:round(income),expenses:round(expenses),withdrawn:round(withdrawn),balance:round(income-expenses-withdrawn),outstanding:round(expected) };
}

// ================== LINE Notify ==================
function isLineMenuCommand_(text) {
  // Exact match after trimming; mentioning the command in a sentence is not a request.
  const command = String(text || '').trim().toLowerCase();
  return command === 'เมนู' || command === 'sec1';
}

function isLineTextCommand_(text) {
  // Compatibility name for older callers; no legacy text commands are accepted.
  return isLineMenuCommand_(text);
}

function parseLinePostback_(data) {
  const params = Object.create(null);
  try {
    String(data || '').split('&').forEach(function (part) {
      const pieces = part.split('=');
      params[decodeURIComponent(pieces[0] || '')] = decodeURIComponent(pieces.slice(1).join('=') || '');
    });
  } catch (error) { return Object.create(null); }
  return params;
}

function isLineMenuEvent_(event) {
  return (event.type === 'message' && event.message && event.message.type === 'text' && isLineMenuCommand_(event.message.text)) ||
    (event.type === 'postback' && parseLinePostback_(event.postback && event.postback.data).action === 'menu');
}

function filterLineEventReplies_(event, messages) {
  const list = (Array.isArray(messages) ? messages : (messages ? [messages] : [])).filter(Boolean);
  if (isLineMenuEvent_(event)) return list;
  // Fail closed for unrelated conversations and unsupported event types.
  if (event.type === 'message') {
    if (!event.message) return [];
    // The two allowed text commands already returned above. All other text is silent,
    // even if a future helper accidentally supplies a card, quick reply or plain text.
    if (event.message.type !== 'image') return [];
  } else if (event.type === 'postback') {
    if (['syncMembers', 'prepareSlip'].indexOf(parseLinePostback_(event.postback && event.postback.data).action) < 0) return [];
  } else { return []; }
  // Last boundary before reply API: helper fallbacks must not inject the main menu.
  return list.filter(function (message) {
    return !(message.type === 'flex' && message.altText === LINE_MENU_ALT_TEXT);
  }).map(function (message) {
    if (!message.quickReply || !Array.isArray(message.quickReply.items)) return message;
    const items = message.quickReply.items.filter(function (item) {
      const action = item.action || {};
      return !(action.type === 'uri' && /^https:\/\/liff\.line\.me\//.test(String(action.uri || '')));
    });
    const copy = Object.assign({}, message);
    if (items.length) copy.quickReply = {items:items};
    else delete copy.quickReply;
    return copy;
  });
}

function handleLineWebhook_(body) {
  try {
    const events = body.events || [];
    events.forEach(function (event) {
      const source = event.source || {};
      const allowedGroup=getConfig_().lineGroupId;
      if(source.type==='group'&&(!allowedGroup||source.groupId!==allowedGroup)){
        Logger.log('SEC1_IGNORED_GROUP expected=' + String(allowedGroup || '(not set)') +
          ' received=' + String(source.groupId || '(missing)'));
        return;
      }
      if (event.type === 'message' && event.message && event.message.type === 'text' && !isLineMenuCommand_(event.message.text)) {
        // Keep silent member discovery, but never dispatch a typed business command.
        if (source.type === 'group' && source.userId) autoSyncLineSourceMember_(source);
        return;
      }
      if(source.type!=='group'&&source.userId&&!getMemberByLineUserId_(source.userId)&&!isLineAdmin_(source.userId)){
        if(event.type === 'message' && event.message && event.message.type !== 'text') return;
        const reply = filterLineEventReplies_(event, [lineText_('กรุณาพิมพ์ เมนู ในกลุ่มที่เชื่อมกับระบบเพื่อผูกสมาชิกก่อน แล้วกลับมาเปิดเมนูครับ')]);
        if(reply.length && event.replyToken) replyLineMessages_(event.replyToken,reply);
        return;
      }
      if (source.type === 'group' && source.groupId) {
        // ดู Group ID นี้ได้ที่เมนู Executions ของ Apps Script (ต้องพิมพ์อะไรก็ได้ในกลุ่มก่อน)
        Logger.log('พบ LINE Group ID: ' + source.groupId + ' (event: ' + event.type + ')');
      }
      if (source.userId) autoSyncLineSourceMember_(source);
      let messages = [];
      if (event.type === 'message' && event.message) {
        if (event.message.type === 'text' && isLineMenuCommand_(event.message.text)) messages = handleLineTextCommand_(String(event.message.text || ''), source);
        if (event.message.type === 'image') messages = handleLineImage_(event.message.id, source);
      } else if (event.type === 'postback') {
        messages = handleLinePostback_(String(event.postback && event.postback.data || ''), source);
      } else if (event.type === 'follow' || event.type === 'join') {
        messages = [];
      } else if (event.type === 'memberJoined') {
        syncJoinedLineMembers_(source.groupId, event.joined && event.joined.members || []);
      } else if (event.type === 'memberLeft') {
        markLeftLineMembersInactive_(source.groupId, event.left && event.left.members || []);
      }
      messages = filterLineEventReplies_(event, messages);
      if (messages.length && event.replyToken) replyLineMessages_(event.replyToken, messages);
    });
  } catch (err) {
    Logger.log('handleLineWebhook_ error: ' + err.message);
  }
  // LINE ต้องได้ HTTP 200 กลับไปเสมอ ไม่ว่าจะประมวลผลสำเร็จหรือไม่
  return ContentService.createTextOutput(JSON.stringify({ success: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function callLineGetJson_(url) {
  const config = getConfig_();
  if (!config.lineChannelAccessToken) throw new Error('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN');
  const response = UrlFetchApp.fetch(url, {
    method: 'get', headers: { Authorization: 'Bearer ' + config.lineChannelAccessToken }, muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  let parsed = {};
  try { parsed = JSON.parse(response.getContentText() || '{}'); } catch (err) {}
  if (code < 200 || code >= 300) throw new Error('LINE API HTTP ' + code + (parsed.message ? ': ' + parsed.message : ''));
  return parsed;
}

function getLineMemberProfile_(userId, groupId) {
  if (!userId) throw new Error('ไม่พบ LINE User ID');
  const url = groupId
    ? 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/member/' + encodeURIComponent(userId)
    : 'https://api.line.me/v2/bot/profile/' + encodeURIComponent(userId);
  return callLineGetJson_(url);
}

function getProfileFromLiffAccessToken_(accessToken) {
  const token = String(accessToken || '').trim();
  if (!token) throw new Error('ไม่พบ LIFF access token');
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
  const tokenHash = Utilities.base64EncodeWebSafe(digest).replace(/=+$/g, '');
  const profileCache = CacheService.getScriptCache();
  const profileCacheKey = 'LIFF_PROFILE_' + tokenHash;
  const cachedProfile = cacheGetJson_(profileCacheKey);
  if (cachedProfile && cachedProfile.userId) return cachedProfile;
  const response = UrlFetchApp.fetch('https://api.line.me/v2/profile', {
    method: 'get', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  let profile = {};
  try { profile = JSON.parse(response.getContentText() || '{}'); } catch (err) {}
  if (code < 200 || code >= 300 || !profile.userId) throw new Error('ตรวจสอบผู้ใช้ LIFF ไม่สำเร็จ (HTTP ' + code + ')');
  cachePutJson_(profileCacheKey, profile, LIFF_PROFILE_CACHE_TTL_SECONDS);
  return profile;
}

function getLiffSession_(accessToken) {
  try {
    const profile = getProfileFromLiffAccessToken_(accessToken);
    const member = getMemberByLineUserId_(profile.userId);
    return {
      success: true,
      userId: profile.userId,
      displayName: profile.displayName || '',
      pictureUrl: profile.pictureUrl || '',
      isAdmin: isLineAdmin_(profile.userId),
      memberId: member ? member.id : '',
      memberName: member ? member.name : '',
      registered: !!member
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function createLiffBill_(body) {
  let profile;
  try { profile = getProfileFromLiffAccessToken_(body.liffAccessToken); }
  catch (err) { return { success: false, message: err.message }; }
  if (!isLineAdmin_(profile.userId)) return { success: false, message: 'คำสั่งนี้สำหรับผู้ดูแลเท่านั้น' };
  if (body.billType === 'monthly') {
    return createMonthlyPlan_({
      title: body.title, amountPerMember: body.amountPerMember, billingDay: 23,
      dueDay: body.dueDay, memberIds: body.memberIds, note: body.note
    });
  }
  return createBill_({
    title: body.title, amountPerMember: body.amountPerMember, dueDate: body.dueDate,
    billType: 'activity', memberIds: body.memberIds, note: body.note, createdBy: profile.userId
  });
}

// ================== LIFF lightweight API ==================
function getLiffCacheVersion_() {
  return CacheService.getScriptCache().get('LIFF_DATA_VERSION') || '1';
}

function invalidateLiffCache_() {
  CacheService.getScriptCache().put('LIFF_DATA_VERSION', String(Date.now()), 21600);
}

function cacheGetJson_(key) {
  try {
    const value = CacheService.getScriptCache().get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) { return null; }
}

function cachePutJson_(key, value, ttl) {
  try {
    const json = JSON.stringify(value);
    if (json.length < 95000) CacheService.getScriptCache().put(key, json, ttl || 60);
  } catch (err) {}
}

function paginateLiff_(items, requestedPage) {
  const total = items.length;
  const pages = Math.max(1, Math.ceil(total / LIFF_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(requestedPage) || 1));
  const start = (page - 1) * LIFF_PAGE_SIZE;
  return {
    items: items.slice(start, start + LIFF_PAGE_SIZE),
    page: page, pageSize: LIFF_PAGE_SIZE, total: total, pages: pages,
    hasPrevious: page > 1, hasNext: page < pages
  };
}

function makeLiffSession_(profile, member) {
  return {
    userId: profile.userId,
    displayName: profile.displayName || '',
    pictureUrl: profile.pictureUrl || '',
    isAdmin: isLineAdmin_(profile.userId),
    memberId: member ? member.id : '',
    memberName: member ? member.name : '',
    registered: !!member
  };
}

function compactBillForLiff_(bill, assignedRows) {
  const rows = assignedRows || [];
  const paid = rows.filter(function (row) { return String(row.status) === 'paid'; }).length;
  const outstanding = rows.reduce(function (sum, row) {
    return sum + Math.max(0, Number(row.amount || 0) - Number(row.paidAmount || 0));
  }, 0);
  return {
    id: String(bill.id), title: String(bill.title || ''), billType: String(bill.billType || 'activity'),
    monthKey: String(bill.monthKey || ''), dueDate: formatDateValue_(bill.dueDate), status: String(bill.status || ''),
    totalExpected: Number(bill.totalExpected) || 0, memberCount: rows.length, paidCount: paid, outstanding: outstanding
  };
}

function buildLiffViewPayload_(view, page, billId, session) {
  const config = getConfig_();
  const publicConfig = {
    liffId: config.liffId, bankName: config.bankName,
    bankAccountNo: config.bankAccountNo, bankAccountName: config.bankAccountName
  };

  if (view === 'create-bill') {
    if (!session.isAdmin) throw new Error('เมนูนี้สำหรับผู้ดูแลเท่านั้น');
    const members = getActiveLineMembers_().map(function (m) {
      return { id: String(m.id), name: String(m.name || ''), pictureUrl: String(m.pictureUrl || '') };
    });
    return { members: members, today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd') };
  }

  if (view === 'summary') {
    const tx = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS));
    const withdrawals = sheetToObjects_(getSheet_(SHEET_WITHDRAWALS));
    const bills = sheetToObjects_(getSheet_(SHEET_BILLS));
    const billMembers = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS));
    return { financeSummary: buildFinanceSummary_(tx, withdrawals, bills, billMembers) };
  }

  if (view === 'expenses') {
    const expenseTx = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)).filter(function (t) { return Number(t.amount) < 0; }).map(function (t) {
      return { id: String(t.id), kind: 'expense', title: String(t.note || t.memberName || 'รายจ่าย'), amount: Math.abs(Number(t.amount) || 0), date: formatDateValue_(t.date) };
    });
    const withdrawals = sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)).map(function (w) {
      return { id: String(w.id), kind: 'withdrawal', title: String(w.purpose || 'ถอนเงินไปใช้'), amount: Number(w.amount) || 0, date: formatDateValue_(w.date) };
    });
    const all = expenseTx.concat(withdrawals).sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    return { history: paginateLiff_(all, page) };
  }

  if (view === 'create-withdrawal') {
    if (!session.isAdmin) throw new Error('เมนูนี้สำหรับผู้ดูแลเท่านั้น');
    const summary = buildFinanceSummary_(sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)), sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)));
    return {
      today: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
      availableBalance: Number(summary.balance) || 0
    };
  }

  const bills = sheetToObjects_(getSheet_(SHEET_BILLS));
  const billMembers = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS));

  if (view === 'payment') {
    if (!session.registered) throw new Error('ยังไม่พบสมาชิกที่ผูกกับบัญชี LINE นี้');
    const bill = bills.find(function (b) { return String(b.id) === String(billId || ''); });
    const assignment = billMembers.find(function (m) {
      return String(m.billId) === String(billId || '') &&
        (String(m.lineUserId || '') === String(session.userId) || String(m.memberId || '') === String(session.memberId));
    });
    if (!bill || !assignment) throw new Error('ไม่พบบิลนี้สำหรับสมาชิกของคุณ');
    return {
      bill: compactBillForLiff_(bill, [assignment]),
      assignment: { id: String(assignment.id), amount: Number(assignment.amount) || 0, paidAmount: Number(assignment.paidAmount) || 0, status: String(assignment.status || '') },
      bank: publicConfig
    };
  }

  if (view === 'my-bills') {
    if (!session.registered) throw new Error('ยังไม่พบสมาชิกที่ผูกกับบัญชี LINE นี้');
    const mine = billMembers.filter(function (m) {
      return String(m.lineUserId || '') === String(session.userId) || String(m.memberId || '') === String(session.memberId);
    });
    const rows = mine.map(function (m) {
      const bill = bills.find(function (b) { return String(b.id) === String(m.billId); });
      if (!bill) return null;
      const item = compactBillForLiff_(bill, [m]);
      item.amount = Number(m.amount) || 0; item.paidAmount = Number(m.paidAmount) || 0; item.paymentStatus = String(m.status || 'unpaid');
      return item;
    }).filter(Boolean).sort(function (a, b) { return new Date(b.dueDate) - new Date(a.dueDate); });
    return { history: paginateLiff_(rows, page) };
  }

  // open-bills
  const open = bills.filter(function (b) { return String(b.status) === 'open'; }).map(function (b) {
    return compactBillForLiff_(b, billMembers.filter(function (m) { return String(m.billId) === String(b.id); }));
  }).sort(function (a, b) { return new Date(a.dueDate) - new Date(b.dueDate); });
  return { history: paginateLiff_(open, page) };
}

function getLiffViewData_(body) {
  try {
    const profile = getProfileFromLiffAccessToken_(body.liffAccessToken);
    const member = getMemberByLineUserId_(profile.userId);
    const session = makeLiffSession_(profile, member);
    const allowed = ['create-bill', 'create-withdrawal', 'my-bills', 'open-bills', 'summary', 'expenses', 'payment'];
    const view = allowed.indexOf(String(body.view || '')) !== -1 ? String(body.view) : 'my-bills';
    const page = Math.max(1, Number(body.page) || 1);
    const billId = String(body.billId || '');
    // อ่านข้อมูลธุรกรรมจาก Google Sheets ใหม่ทุกครั้ง เพื่อให้หน้าที่เปิดตรงกับฐานข้อมูลปัจจุบัน
    const data = buildLiffViewPayload_(view, page, billId, session);
    return { success: true, session: session, view: view, data: data, cached: false, freshFromDatabase: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function getLiffBillAssignment_(profile, billId) {
  const member = getMemberByLineUserId_(profile.userId);
  if (!member) throw new Error('ยังไม่พบสมาชิกที่ผูกกับบัญชี LINE นี้');
  const billFound = findObjectByField_(getSheet_(SHEET_BILLS), 'id', billId);
  if (!billFound || String(billFound.object.status) !== 'open') throw new Error('ไม่พบบิลหรือบิลปิดแล้ว');
  const assignment = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).find(function (row) {
    return String(row.billId) === String(billId) &&
      (String(row.lineUserId || '') === String(profile.userId) || String(row.memberId || '') === String(member.id));
  });
  if (!assignment) throw new Error('บิลนี้ไม่ได้เรียกเก็บจากสมาชิกของคุณ');
  if (String(assignment.status) === 'paid') throw new Error('บิลนี้ชำระครบแล้ว');
  return { member: member, bill: billFound.object, assignment: assignment };
}

function uploadLiffSlip_(body) {
  let createdFile = null;
  try {
    const profile = getProfileFromLiffAccessToken_(body.liffAccessToken);
    const assigned = getLiffBillAssignment_(profile, String(body.billId || ''));
    if (!body.imageBase64) throw new Error('ไม่พบรูปสลิป');
    const base64 = String(body.imageBase64).split(',').pop();
    const bytes = Utilities.base64Decode(base64);
    if (bytes.length > 4500000) throw new Error('ไฟล์สลิปใหญ่เกิน 4.5 MB');
    const mime = String(body.mimeType || 'image/jpeg');
    const safeName = String(assigned.member.name || 'member').replace(/[^\u0E00-\u0E7Fa-zA-Z0-9_-]+/g, '_').slice(0, 60);
    const folder = DriveApp.getFolderById(getConfig_().driveFolderId);
    createdFile = folder.createFile(Utilities.newBlob(bytes, mime, 'liff_' + safeName + '_' + Date.now() + '.jpg'));
    const ocr = ocrSlip_(base64, mime);
    const pendingToken = Utilities.getUuid();
    const pending = {
      userId: profile.userId, billId: String(assigned.bill.id), memberId: String(assigned.member.id),
      memberName: String(assigned.member.name), slipUrl: createdFile.getUrl(), fileId: createdFile.getId(),
      expectedAmount: Math.max(0, Number(assigned.assignment.amount || 0) - Number(assigned.assignment.paidAmount || 0)),
      ocr: ocr.success ? (ocr.data || ocr.parsed || {}) : {}, createdAt: new Date().toISOString()
    };
    cachePutJson_('LIFF_SLIP_' + pendingToken, pending, LIFF_PENDING_SLIP_TTL_SECONDS);
    if (!cacheGetJson_('LIFF_SLIP_' + pendingToken)) throw new Error('ไม่สามารถสร้างรายการรอยืนยัน กรุณาลองใหม่');
    return { success: true, pendingToken: pendingToken, ocr: ocr, expectedAmount: pending.expectedAmount, memberName: pending.memberName, billTitle: String(assigned.bill.title || '') };
  } catch (err) {
    if (createdFile) { try { createdFile.setTrashed(true); } catch (cleanupErr) {} }
    return { success: false, message: err.message };
  }
}

function confirmLiffSlip_(body) {
  try {
    const profile = getProfileFromLiffAccessToken_(body.liffAccessToken);
    const token = String(body.pendingToken || '');
    const cache = CacheService.getScriptCache();
    const pending = cacheGetJson_('LIFF_SLIP_' + token);
    if (!pending) throw new Error('รายการอัปโหลดหมดอายุ กรุณาเลือกสลิปใหม่');
    if (String(pending.userId) !== String(profile.userId)) throw new Error('ไม่มีสิทธิ์ยืนยันรายการนี้');
    const assigned = getLiffBillAssignment_(profile, pending.billId);
    const amount = Number(body.amount || pending.expectedAmount);
    const ocr = pending.ocr || {};
    const result = confirmTransaction_({
      type: 'deposit', memberName: assigned.member.name, slipOwnerName: assigned.member.name,
      amount: amount, date: body.date || ocr.date || new Date().toISOString(),
      note: String(body.note || ('ชำระบิล ' + (assigned.bill.title || ''))), billId: pending.billId,
      ocrSenderName: ocr.senderName || '', ocrSenderBank: ocr.senderBank || '',
      ocrBankApp: ocr.bankApp || '', ocrReferenceNo: ocr.referenceNo || '',
      nameMatchStatus: 'liff-verified-user', clientRequestId: 'liff_' + token,
      _savedSlipUrl: pending.slipUrl
    });
    if (result.success) cache.remove('LIFF_SLIP_' + token);
    return result;
  } catch (err) {
    return { success: false, message: err.message };
  }
}

function createLiffWithdrawal_(body) {
  let createdFile = null;
  try {
    const profile = getProfileFromLiffAccessToken_(body.liffAccessToken);
    if (!isLineAdmin_(profile.userId)) throw new Error('เมนูนี้สำหรับผู้ดูแลเท่านั้น');
    const amount = Number(body.amount);
    const purpose = String(body.purpose || '').trim();
    if (!Number.isFinite(amount) || amount <= 0) throw new Error('จำนวนเงินต้องมากกว่า 0');
    if (!purpose) throw new Error('กรุณาระบุวัตถุประสงค์การใช้เงิน');
    if (!body.imageBase64) throw new Error('กรุณาแนบหลักฐานการถอนหรือสลิป');
    const base64 = String(body.imageBase64).split(',').pop();
    const bytes = Utilities.base64Decode(base64);
    if (bytes.length > 4500000) throw new Error('ไฟล์หลักฐานใหญ่เกิน 4.5 MB');
    const folder = DriveApp.getFolderById(getConfig_().driveFolderId);
    createdFile = folder.createFile(Utilities.newBlob(bytes, String(body.mimeType || 'image/jpeg'), 'withdrawal_' + Date.now() + '.jpg'));
    const result = addWithdrawal_({
      amount: amount, date: body.date, purpose: purpose,
      withdrawnBy: profile.displayName || profile.userId, proofUrl: createdFile.getUrl()
    });
    if (!result.success) throw new Error(result.message || 'บันทึกถอนเงินไม่สำเร็จ');
    sendLineGroupMessages_([
      lineText_('📤 บันทึกถอนเงิน\nใช้สำหรับ: ' + purpose + '\nจำนวน: ' + amount.toLocaleString('th-TH') + ' บาท\nวันที่: ' + String(body.date || '').substring(0, 10)),
      buildLineMenuMessage_('')
    ]);
    return { success: true, id: result.id, proofUrl: createdFile.getUrl() };
  } catch (err) {
    if (createdFile) { try { createdFile.setTrashed(true); } catch (cleanupErr) {} }
    return { success: false, message: err.message };
  }
}

function getLineGroupMemberIds_(groupId) {
  if (!groupId) throw new Error('ไม่พบ LINE Group ID');
  const all = [];
  let start = '';
  do {
    const url = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/members/ids' + (start ? '?start=' + encodeURIComponent(start) : '');
    const data = callLineGetJson_(url);
    (data.memberIds || []).forEach(function (id) { if (all.indexOf(String(id)) === -1) all.push(String(id)); });
    start = String(data.next || '');
  } while (start);
  return all;
}

function getActiveLineMembers_() {
  return sheetToObjects_(getSheet_(SHEET_MEMBERS)).filter(function (member) {
    return String(member.status || 'active').toLowerCase() !== 'inactive';
  });
}

function makeUniqueMemberName_(preferredName, currentId) {
  const base = String(preferredName || 'สมาชิก LINE').trim() || 'สมาชิก LINE';
  const rows = sheetToObjects_(getSheet_(SHEET_MEMBERS));
  let candidate = base;
  let number = 2;
  while (rows.some(function (row) {
    return String(row.id) !== String(currentId || '') && String(row.name || '').trim() === candidate;
  })) {
    candidate = base + ' (LINE ' + number + ')';
    number += 1;
  }
  return candidate;
}

function upsertLineMember_(profile, groupId) {
  const userId = String(profile && profile.userId || '').trim();
  const displayName = String(profile && profile.displayName || '').trim() || 'สมาชิก LINE';
  if (!userId) return { success: false, action: 'skipped', message: 'ไม่พบ LINE User ID' };
  const sheet = getSheet_(SHEET_MEMBERS);
  ensureHeaders_(sheet, MEMBER_HEADERS);
  const rows = sheetToObjects_(sheet);
  let member = rows.find(function (row) { return String(row.lineUserId || '') === userId; });
  if (!member) {
    member = rows.find(function (row) {
      return !String(row.lineUserId || '').trim() && String(row.name || '').trim() === displayName;
    });
  }
  const now = new Date().toISOString();
  if (member) {
    updateObjectField_(sheet, 'id', member.id, {
      lineUserId: userId, lineDisplayName: displayName, pictureUrl: String(profile.pictureUrl || ''), status: 'active',
      sourceGroupId: String(groupId || member.sourceGroupId || ''), updatedAt: now
    });
    return { success: true, action: 'updated', id: member.id, name: member.name || displayName };
  }
  const id = 'm_' + Utilities.getUuid();
  const uniqueName = makeUniqueMemberName_(displayName, '');
  appendRowByHeaders_(sheet, MEMBER_HEADERS, {
    id: id, name: uniqueName, lineUserId: userId, lineDisplayName: displayName,
    pictureUrl: String(profile.pictureUrl || ''), status: 'active', sourceGroupId: String(groupId || ''),
    createdAt: now, updatedAt: now
  });
  return { success: true, action: 'created', id: id, name: uniqueName };
}

function syncLineGroupMembers_(groupId) {
  const ids = getLineGroupMemberIds_(groupId);
  const summary = { success: true, total: ids.length, created: 0, updated: 0, skipped: 0, errors: [] };
  ids.forEach(function (userId) {
    try {
      const profile = getLineMemberProfile_(userId, groupId);
      profile.userId = userId;
      const result = upsertLineMember_(profile, groupId);
      if (result.action === 'created') summary.created += 1;
      else if (result.action === 'updated') summary.updated += 1;
      else summary.skipped += 1;
    } catch (err) {
      summary.skipped += 1;
      summary.errors.push(userId.substring(0, 8) + ': ' + err.message);
    }
  });
  return summary;
}

function autoSyncLineSourceMember_(source) {
  const cache = CacheService.getScriptCache();
  const key = 'LINE_MEMBER_SYNC_' + String(source.userId || '');
  if (!source.userId || cache.get(key)) return;
  try {
    const profile = getLineMemberProfile_(source.userId, source.type === 'group' ? source.groupId : '');
    profile.userId = source.userId;
    withScriptLock_(function () { return upsertLineMember_(profile, source.groupId || ''); });
    cache.put(key, '1', 21600);
  } catch (err) { Logger.log('autoSyncLineSourceMember_ error: ' + err.message); }
}

function syncJoinedLineMembers_(groupId, members) {
  (members || []).forEach(function (item) {
    if (!item || item.type !== 'user' || !item.userId) return;
    try {
      const profile = getLineMemberProfile_(item.userId, groupId);
      profile.userId = item.userId;
      withScriptLock_(function () { return upsertLineMember_(profile, groupId); });
    } catch (err) { Logger.log('syncJoinedLineMembers_ error: ' + err.message); }
  });
}

function markLeftLineMembersInactive_(groupId, members) {
  const sheet = getSheet_(SHEET_MEMBERS);
  const rows = sheetToObjects_(sheet);
  (members || []).forEach(function (item) {
    if (!item || item.type !== 'user' || !item.userId) return;
    const member = rows.find(function (row) { return String(row.lineUserId || '') === String(item.userId); });
    if (member) updateObjectField_(sheet, 'id', member.id, {
      status: 'inactive', sourceGroupId: String(groupId || ''), updatedAt: new Date().toISOString()
    });
  });
}

function buildLineMemberListMessage_() {
  const members = getActiveLineMembers_();
  const lines = members.slice(0, 100).map(function (member, index) {
    return (index + 1) + '. ' + member.name + (member.lineDisplayName && member.lineDisplayName !== member.name ? ' (LINE: ' + member.lineDisplayName + ')' : '');
  });
  return lineText_('👥 สมาชิกในระบบ ' + members.length + ' คน\n\n' + (lines.join('\n') || 'ยังไม่มีสมาชิก') + (members.length > 100 ? '\n\nแสดง 100 คนแรก' : ''));
}

function isLineGroupMemberListPermissionError_(err) {
  const message = String(err && err.message || err || '');
  return /HTTP\s*403/i.test(message) && /Access to this API is not available/i.test(message);
}

function buildLineRegistrationRequestMessage_() {
  return lineText_('📣 เชิญสมาชิกผูกบัญชี\n\nบัญชี LINE OA นี้ยังไม่มีสิทธิ์ดึงรายชื่อทั้งหมดพร้อมกัน กรุณากด “เปิดเมนูและผูกสมาชิก” ในกลุ่มที่เชื่อมกับระบบ ระบบจะบันทึกสมาชิกจากโปรไฟล์ LINE ให้อัตโนมัติ', {
    items: [{ type: 'action', action: { type: 'message', label: 'เปิดเมนูและผูกสมาชิก', text: 'เมนู' } }]
  });
}

function syncLineMembersOrFallback_(groupId) {
  try {
    return { mode: 'full', result: syncLineGroupMembers_(groupId) };
  } catch (err) {
    if (isLineGroupMemberListPermissionError_(err)) return { mode: 'self-registration', result: null };
    throw err;
  }
}

function lineNotificationMessages_(messages, userId) {
  // All push paths use this boundary; every notification carries one menu.
  const list = (Array.isArray(messages) ? messages : (messages ? [messages] : [])).filter(Boolean);
  const content = list.filter(function (message) {
    return !(message.type === 'flex' && message.altText === LINE_MENU_ALT_TEXT);
  });
  // Preserve the full notification rather than silently dropping a message or menu.
  if (content.length > 4) throw Error('แบ่งการแจ้งเตือนเป็นชุดละไม่เกิน 4 ข้อความเพื่อแนบเมนูได้ทุกชุด');
  const text=JSON.stringify(content),mood=/แก้มป่อง|เลยกำหนด|😤/.test(text)?'angry':/ชำระครบ|ขอบคุณ|🥳/.test(text)?'happy':'waiting';
  return content.concat([buildLineMenuMessage_(userId||'',mood)]);
}

function sendLineMessage_(text) {
  return sendLineGroupMessages_([lineText_(text)]);
}

function sendLineGroupMessages_(messages) {
  try {
    const config = getConfig_();
    if (!config.lineChannelAccessToken || !config.lineGroupId) {
      Logger.log('ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_GROUP_ID ข้ามการแจ้งเตือน');
      return { success: false, statusCode: 0, message: 'ยังไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN หรือ LINE_GROUP_ID' };
    }
    const payload = { to: config.lineGroupId, messages: lineNotificationMessages_(messages, '') };
    const options = {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.lineChannelAccessToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(LINE_MESSAGING_PUSH_URL, options);
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      Logger.log('LINE push error ' + code + ': ' + response.getContentText());
      return { success: false, statusCode: code, message: response.getContentText() || 'LINE push failed' };
    }
    return { success: true, statusCode: code, target: config.lineGroupId };
  } catch (err) {
    Logger.log('sendLineGroupMessages_ error: ' + err.message);
    return { success: false, statusCode: 0, message: err.message };
  }
}

// ข้อความประกาศเมื่อสร้าง "กิจกรรมเฉพาะกิจ" ใหม่
function buildActivityAnnouncementMessage_(name, targetAmount) {
  const cleanName = String(name || '').trim();
  const amountText = Number(targetAmount) > 0
    ? ' จำนวน ' + Number(targetAmount).toLocaleString('th-TH') + ' บาท'
    : '';
  return '📢 สวัสดีสมาชิกในกลุ่มทุกคนค่ะ! แจ้งเตือน "' + cleanName + '"' + amountText +
    ' สามารถโอนเงินได้ที่ (บัญชีใหม่) ' +
    'บัญชี ธ.กรุงไทย 9020878972 นางสุวดี หีมปอง\n\n' +
    'และสามารถแจ้งข้อมูลการโอนเงินได้ที่ลิงก์ด้านล่างนี้เลยค่ะ👇\n' +
    'https://jirayut-sa.github.io/slip/';
}

function normalizeMonthKeyServer_(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  return match ? match[1] + '-' + match[2] : '';
}

function nextMonthKeyServer_(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  const now = new Date();
  if (!match) return getCurrentMonthKeyServer_();
  let year = Number(match[1]);
  let month = Number(match[2]) + 1;
  if (month > 12) { month = 1; year += 1; }
  return year + '-' + String(month).padStart(2, '0');
}

function getCurrentMonthKeyServer_() {
  return Utilities.formatDate(new Date(), APP_TIMEZONE, 'yyyy-MM');
}

function formatThaiMonthServer_(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return 'เดือนนี้';
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return names[Number(match[2]) - 1] + ' ' + (Number(match[1]) + 543);
}

// แปลงวันที่ปัจจุบันเป็นรูปแบบไทยเต็ม เช่น "25 สิงหาคม 2569"
function formatThaiFullDateServer_(date) {
  const names = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  return date.getDate() + ' ' + names[date.getMonth()] + ' ' + (date.getFullYear() + 543);
}

// คำนวณรอบเก็บเงินรายเดือนที่กำลัง active ฝั่งเซิร์ฟเวอร์ (ตรรกะเดียวกับหน้าเว็บ)
function computeActiveCycleServer_() {
  const members = sheetToObjects_(getSheet_(SHEET_MEMBERS));
  const transactions = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS));
  const skippedMonths = sheetToObjects_(getSheet_(SHEET_SKIPPED_MONTHS))
    .map(function (row) { return normalizeMonthKeyServer_(row.monthKey); });

  const monthlyTxns = transactions.filter(function (t) {
    return (Number(t.amount) || 0) > 0 && !t.activityId;
  });

  function totalForMonth(mk) {
    return monthlyTxns.reduce(function (sum, t) {
      return normalizeMonthKeyServer_(formatDateValue_(t.date)) === mk ? sum + (Number(t.amount) || 0) : sum;
    }, 0);
  }

  const monthsWithDeposit = monthlyTxns
    .map(function (t) { return normalizeMonthKeyServer_(formatDateValue_(t.date)); })
    .filter(Boolean)
    .sort();

  let monthKey = monthsWithDeposit[0] || getCurrentMonthKeyServer_();

  for (let guard = 0; guard < 240; guard++) {
    if (skippedMonths.indexOf(monthKey) !== -1 || totalForMonth(monthKey) >= MONTHLY_DEPOSIT_TARGET) {
      monthKey = nextMonthKeyServer_(monthKey);
      continue;
    }
    break;
  }

  const total = totalForMonth(monthKey);
  const paidNames = {};
  monthlyTxns.forEach(function (t) {
    if (normalizeMonthKeyServer_(formatDateValue_(t.date)) === monthKey && t.memberName && t.slipUrl) {
      paidNames[String(t.memberName).trim()] = true;
    }
  });
  const missingMembers = members.filter(function (m) {
    return !paidNames[String(m.name || '').trim()];
  });

  return { monthKey: monthKey, total: total, missingMembers: missingMembers };
}

// เรียกจาก time-driven trigger ทุกวันที่ 25 เท่านั้น
function monthlyReminder_() {
  try {
    const cycle = computeActiveCycleServer_();
    const monthLabel = formatThaiMonthServer_(cycle.monthKey);
    const todayLabel = formatThaiFullDateServer_(new Date());

    const text = '📢 สวัสดีสมาชิกในกลุ่มทุกคนค่ะ! แจ้งเตือนประจำเดือน' + monthLabel +
      ' วันที่ ' + todayLabel + ' จำนวน 300 บาท สามารถโอนเงินได้ที่ (บัญชีใหม่) ' +
      'บัญชี ธ.กรุงไทย 9020878972 นางสุวดี หีมปอง\n\n' +
      'และสามารถแจ้งข้อมูลการโอนเงินได้ที่ลิงก์ด้านล่างนี้เลยค่ะ👇\n' +
      'https://jirayut-sa.github.io/slip/';

    sendLineMessage_(text);
  } catch (err) {
    Logger.log('monthlyReminder_ error: ' + err.message);
  }
}

// รันฟังก์ชันนี้ 1 ครั้งหลัง Deploy เพื่อสร้างรอบหลัก 12:00 และรอบสำรอง 12:30 (เวลาไทย)
function setupMonthlyLineTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'monthlyReminder_' || trigger.getHandlerFunction() === 'dailyBillingAutomation_') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('dailyBillingAutomation_')
    .timeBased().everyDays(1).atHour(12).nearMinute(0)
    .inTimezone(APP_TIMEZONE).create();
  ScriptApp.newTrigger('dailyBillingAutomation_')
    .timeBased().everyDays(1).atHour(12).nearMinute(30)
    .inTimezone(APP_TIMEZONE).create();
  const result = { success: true, timezone: APP_TIMEZONE, schedules: ['12:00', '12:30 retry'] };
  Logger.log(JSON.stringify(result));
  return result;
}

// ================== Gemini OCR ==================
function ocrSlip_(imageBase64, mimeType) {
  if (!imageBase64) return { success: false, message: 'ไม่พบรูปภาพที่จะอ่าน' };
  const config = getConfig_();
  if (!config.geminiApiKey) {
    return { success: false, message: 'ยังไม่ได้ตั้งค่า Script Property: GEMINI_API_KEY' };
  }

  const base64Data = String(imageBase64).split(',').pop();
  const cleanMime = mimeType || 'image/jpeg';
  const prompt = 'อ่านสลิปการเงินและตอบเป็น JSON เท่านั้นตาม schema ที่กำหนด. Follow rules: ' +
    '- amount: number only (no comma, no unit). ' +
    '- date: YYYY-MM-DD (convert BE to AD by -543). ' +
    '- time: HH:MM. ' +
    '- senderName: ชื่อ-นามสกุลของ "ผู้โอน" ตามที่เห็นในภาพเท่านั้น โดยคงคำนำหน้าชื่อ. ' +
    '- senderBank: Bank/App name. ' +
    '- receiverName: Full name of receiver. ' +
    '- receiverBank: Bank name of receiver. ' +
    '- referenceNo: Ref code. ' +
    '- bankApp: Source app/bank. ' +
    '- confidence: number 0-1 reflecting visual legibility only. ' +
    '- warnings: array of uncertain or unreadable fields. ' +
    'If missing, return "" for text or null for number. No markdown, no extra text.';

  const models = getGeminiModelOrder_(config.geminiModels).slice(0, 2);
  if (!models.length) {
    return {
      success: false,
      manualEntryAllowed: true,
      message: 'โมเดล OCR ทุกตัวถูกพักชั่วคราว กรุณากรอกข้อมูลจากสลิปด้วยตนเองแล้วบันทึกต่อได้'
    };
  }

  const cache = CacheService.getScriptCache();
  const errors = [];
  const candidates = [];

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const model = models[modelIndex];
    const isPro = model === OCR_PRO_MODEL || /pro/i.test(model);
    const payload = buildGeminiOcrPayload_(prompt, base64Data, cleanMime, model);
    let result = callGeminiOcrModel_(model, config.geminiApiKey, payload);

    // Retry เพียงครั้งเดียวเฉพาะ timeout/ข้อผิดพลาดเซิร์ฟเวอร์ เพื่อไม่ให้ผู้ใช้รอนาน
    if (!result.success && isTransientGeminiStatus_(result.statusCode)) {
      Utilities.sleep(OCR_TRANSIENT_RETRY_DELAY_MS + Math.floor(Math.random() * 151));
      result = callGeminiOcrModel_(model, config.geminiApiKey, payload);
    }

    if (result.success) {
      const parsedResult = parseGeminiOcrResult_(result.responseText);
      if (parsedResult.success) {
        const quality = evaluateOcrQuality_(parsedResult.parsed);
        candidates.push({ model: model, rawText: parsedResult.rawText, parsed: parsedResult.parsed, quality: quality });
        const amountNeedsPro = Number(parsedResult.parsed.amount || 0) >= config.ocrProVerifyAmount;
        const needsProVerification = !isPro && (quality.score < config.ocrQualityThreshold || amountNeedsPro);
        if (needsProVerification && models.slice(modelIndex + 1).some(function (name) { return name === OCR_PRO_MODEL || /pro/i.test(name); })) continue;
        if (isPro || quality.score >= config.ocrQualityThreshold) {
          const finalResult = selectBestOcrCandidate_(candidates, config.ocrQualityThreshold);
          if (!finalResult.needsManualReview) cache.put(OCR_LAST_GOOD_MODEL_CACHE_KEY, finalResult.model, OCR_LAST_GOOD_MODEL_TTL_SECONDS);
          return buildOcrSuccessResponse_(finalResult, modelIndex > 0, candidates);
        }
        errors.push(model + ': คุณภาพ OCR ' + quality.score + '/100');
        continue;
      }

      errors.push(model + ': รูปแบบผลลัพธ์ไม่ถูกต้อง');
      cache.put(getOcrModelCooldownKey_(model), '1', OCR_SERVER_COOLDOWN_SECONDS);
      continue;
    }

    errors.push(model + ': HTTP ' + (result.statusCode || 'NETWORK'));

    if (result.statusCode === 401 || result.statusCode === 403) {
      return {
        success: false,
        manualEntryAllowed: true,
        message: 'API Key ไม่มีสิทธิ์เรียก Gemini API กรุณาตรวจสอบ GEMINI_API_KEY แล้วกรอกข้อมูลด้วยตนเองชั่วคราว'
      };
    }

    applyGeminiModelCooldown_(cache, model, result.statusCode);
  }

  if (candidates.length) {
    const best = selectBestOcrCandidate_(candidates, config.ocrQualityThreshold);
    return buildOcrSuccessResponse_(best, true, candidates);
  }

  return {
    success: false,
    manualEntryAllowed: true,
    attemptedModels: models,
    message: 'OCR ทุกโมเดลยังไม่พร้อมใช้งาน (' + errors.join(', ') + ') กรุณากรอกข้อมูลจากสลิปด้วยตนเองแล้วบันทึกต่อได้'
  };
}

function buildGeminiOcrPayload_(prompt, base64Data, cleanMime, model) {
  const thinkingLevel = /pro/i.test(String(model || '')) ? 'low' : 'minimal';
  return {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: cleanMime, data: base64Data } }
      ]
    }],
    generationConfig: {
      temperature: 0,
      maxOutputTokens: 512,
      thinkingConfig: { thinkingLevel: thinkingLevel },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          amount: { type: 'NUMBER', nullable: true },
          date: { type: 'STRING' },
          time: { type: 'STRING' },
          senderName: { type: 'STRING' },
          senderBank: { type: 'STRING' },
          receiverName: { type: 'STRING' },
          receiverBank: { type: 'STRING' },
          referenceNo: { type: 'STRING' },
          bankApp: { type: 'STRING' },
          confidence: { type: 'NUMBER', nullable: true },
          warnings: { type: 'ARRAY', items: { type: 'STRING' } }
        },
        required: ['amount', 'date', 'senderName']
      }
    }
  };
}

function getGeminiModelOrder_(configuredModels) {
  const configured = String(configuredModels || '')
    .split(',')
    .map(function (model) { return normalizeGeminiModelName_(model); })
    .filter(function (model) { return !!model; });
  const source = configured.length ? configured : GEMINI_MODEL_FALLBACKS.slice();
  const unique = [];
  source.forEach(function (model) {
    if (unique.indexOf(model) === -1) unique.push(model);
  });

  const cache = CacheService.getScriptCache();
  // รักษาลำดับที่กำหนดไว้เสมอ: Flash ต้องเป็นรอบแรกเพื่อความเร็ว และ Pro ใช้ตรวจซ้ำตามเงื่อนไข
  return unique.filter(function (model) {
    return !cache.get(getOcrModelCooldownKey_(model));
  });
}

function normalizeGeminiModelName_(model) {
  return String(model || '').trim().replace(/^models\//, '');
}

function getOcrModelCooldownKey_(model) {
  return 'OCR_MODEL_COOLDOWN_' + String(model || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function callGeminiOcrModel_(model, apiKey, payload) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
    encodeURIComponent(model) + ':generateContent';
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'x-goog-api-key': apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const statusCode = response.getResponseCode();
    return {
      success: statusCode >= 200 && statusCode < 300,
      statusCode: statusCode,
      responseText: response.getContentText()
    };
  } catch (err) {
    return {
      success: false,
      statusCode: 0,
      responseText: '',
      message: err.message || 'Network error'
    };
  }
}

function isTransientGeminiStatus_(statusCode) {
  return statusCode === 0 || statusCode === 408 ||
    statusCode === 500 || statusCode === 502 ||
    statusCode === 503 || statusCode === 504;
}

function applyGeminiModelCooldown_(cache, model, statusCode) {
  let seconds = OCR_SERVER_COOLDOWN_SECONDS;
  if (statusCode === 404 || statusCode === 400) {
    seconds = OCR_NOT_FOUND_COOLDOWN_SECONDS;
  } else if (statusCode === 429) {
    seconds = OCR_RATE_LIMIT_COOLDOWN_SECONDS;
  }
  cache.put(getOcrModelCooldownKey_(model), '1', seconds);
}

function parseGeminiOcrResult_(responseText) {
  let responseJson;
  try {
    responseJson = JSON.parse(responseText);
  } catch (err) {
    return { success: false };
  }

  const candidate = responseJson.candidates && responseJson.candidates[0];
  const parts = candidate && candidate.content && candidate.content.parts || [];
  let textPart = '';
  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    if (parts[partIndex] && parts[partIndex].text && !parts[partIndex].thought) {
      textPart = parts[partIndex].text;
      break;
    }
  }
  if (!textPart) {
    return { success: false };
  }

  let parsed;
  try {
    const cleanJson = String(textPart).trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    parsed = JSON.parse(cleanJson);
  } catch (err) {
    return { success: false };
  }

  return {
    success: true,
    rawText: textPart,
    parsed: {
      amount: parsed.amount !== undefined && parsed.amount !== null && parsed.amount !== ''
        ? Number(parsed.amount)
        : null,
      date: parsed.date || '',
      time: parsed.time || '',
      senderName: String(parsed.senderName || '').trim(),
      senderBank: String(parsed.senderBank || '').trim(),
      receiverName: String(parsed.receiverName || '').trim(),
      receiverBank: String(parsed.receiverBank || '').trim(),
      referenceNo: String(parsed.referenceNo || '').trim(),
      bankApp: String(parsed.bankApp || '').trim(),
      confidence: parsed.confidence !== undefined && parsed.confidence !== null ? Number(parsed.confidence) : null,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String).slice(0, 10) : []
    }
  };
}

function evaluateOcrQuality_(parsed) {
  const reasons = [];
  let score = 0;
  const amount = Number(parsed && parsed.amount);
  if (Number.isFinite(amount) && amount > 0 && amount < 10000000) score += 30;
  else reasons.push('ยอดเงินไม่ถูกต้องหรืออ่านไม่พบ');

  if (/^\d{4}-\d{2}-\d{2}$/.test(String(parsed && parsed.date || '')) && !isNaN(new Date(parsed.date + 'T00:00:00').getTime())) score += 15;
  else reasons.push('วันที่ไม่ครบหรือรูปแบบไม่ถูกต้อง');
  if (String(parsed && parsed.senderName || '').trim().length >= 2) score += 15;
  else reasons.push('ไม่พบชื่อผู้โอน');
  if (String(parsed && parsed.receiverName || '').trim().length >= 2) score += 15;
  else reasons.push('ไม่พบชื่อผู้รับ');
  if (String(parsed && parsed.referenceNo || '').replace(/\s/g, '').length >= 6) score += 10;
  else reasons.push('ไม่พบเลขอ้างอิง');
  if (String(parsed && parsed.senderBank || parsed && parsed.bankApp || '').trim()) score += 5;
  else reasons.push('ไม่พบธนาคารผู้โอน');
  if (String(parsed && parsed.receiverBank || '').trim()) score += 5;
  else reasons.push('ไม่พบธนาคารผู้รับ');
  const confidence = Number(parsed && parsed.confidence);
  if (Number.isFinite(confidence) && confidence >= 0.8) score += 5;
  if (parsed && parsed.warnings && parsed.warnings.length) reasons.push.apply(reasons, parsed.warnings);
  return { score: Math.min(100, score), reasons: reasons };
}

function normalizeOcrCompareValue_(value) {
  return String(value === undefined || value === null ? '' : value).toLowerCase().replace(/[\s.,\-_/]/g, '');
}

function compareOcrCandidates_(a, b) {
  if (!a || !b) return { matchedFields: 0, conflicts: [] };
  const conflicts = [];
  let matchedFields = 0;
  [['amount', true], ['date', false], ['referenceNo', false], ['receiverName', false]].forEach(function (item) {
    const field = item[0];
    const left = item[1] ? Number(a.parsed[field]) : normalizeOcrCompareValue_(a.parsed[field]);
    const right = item[1] ? Number(b.parsed[field]) : normalizeOcrCompareValue_(b.parsed[field]);
    if (left && right && left === right) matchedFields += 1;
    else if (left && right) conflicts.push(field);
  });
  return { matchedFields: matchedFields, conflicts: conflicts };
}

function selectBestOcrCandidate_(candidates, threshold) {
  const sorted = candidates.slice().sort(function (a, b) { return b.quality.score - a.quality.score; });
  const best = sorted[0];
  const comparison = candidates.length > 1 ? compareOcrCandidates_(candidates[0], candidates[1]) : { matchedFields: 0, conflicts: [] };
  return {
    model: best.model, rawText: best.rawText, parsed: best.parsed, quality: best.quality,
    verifiedByModels: candidates.map(function (c) { return c.model; }),
    comparison: comparison,
    needsManualReview: best.quality.score < Number(threshold || OCR_DEFAULT_QUALITY_THRESHOLD) || comparison.conflicts.indexOf('amount') !== -1 || comparison.conflicts.indexOf('receiverName') !== -1
  };
}

function buildOcrSuccessResponse_(candidate, fallbackUsed, allCandidates) {
  return {
    success: true,
    rawText: candidate.rawText,
    modelUsed: candidate.model,
    fallbackUsed: !!fallbackUsed,
    parsed: candidate.parsed,
    qualityScore: candidate.quality.score,
    qualityReasons: candidate.quality.reasons,
    verifiedByModels: candidate.verifiedByModels,
    comparison: candidate.comparison,
    needsManualReview: candidate.needsManualReview,
    candidatesChecked: (allCandidates || []).length
  };
}

function sendLineMessagesTo_(target, messages) {
  try {
    const config = getConfig_();
    if (!config.lineChannelAccessToken || !target) return { success: false, statusCode: 0, message: 'ไม่พบ LINE token หรือผู้รับ' };
    const response = UrlFetchApp.fetch(LINE_MESSAGING_PUSH_URL, {
      method: 'post', contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + config.lineChannelAccessToken },
      payload: JSON.stringify({ to: target, messages: lineNotificationMessages_(messages, target) }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      const errorText = response.getContentText() || 'LINE push failed';
      Logger.log('LINE personal push error ' + code + ' target=' + target + ': ' + errorText);
      return { success: false, statusCode: code, message: errorText, target: target };
    }
    return { success: true, statusCode: code, target: target };
  } catch (err) {
    Logger.log('sendLineMessagesTo_ error: ' + err.message);
    return { success: false, statusCode: 0, message: err.message, target: target };
  }
}

function getBangkokDateKey_(date) {
  return Utilities.formatDate(date || new Date(), APP_TIMEZONE, 'yyyy-MM-dd');
}

function getBangkokDayOfMonth_(date) {
  return Number(Utilities.formatDate(date || new Date(), APP_TIMEZONE, 'd'));
}

function dailyBillingAutomation_() {
  return withScriptLock_(function(){
    const started=Date.now();const report={at:new Date().toISOString(),accepted:0,failed:0,skipped:0,errors:[]};
    try{generateMonthlyBills_();}catch(e){report.errors.push(e.message);}
    const day=getBangkokDayOfMonth_(new Date());
    secRows_('Bills').filter(b=>b.status==='open'&&(b.billType!=='monthly'||(day>=23&&day<=28))).forEach(b=>{
      try{if(Date.now()-started>240000){report.errors.push('ถึงขีดเวลารอบนี้ บิลที่เหลือจะลองในรอบสำรอง');return;}const r=secNotifyBill_(b.id);report.accepted+=r.accepted;report.failed+=r.failed;report.skipped+=r.skipped;}catch(e){report.errors.push(String(b.id)+': '+e.message);}
    });
    try{if(PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_ENABLED')==='true')report.game=gameRepair_();}catch(e){report.errors.push('เกม: '+e.message);}
    PropertiesService.getScriptProperties().setProperty('SEC1_LAST_RUN',JSON.stringify(report));
    Logger.log(JSON.stringify(report));return report;
  });
}

function wasBillRemindedToday_(billId,today){ return false; /* ledger ตรวจแต่ละช่องทางแทน */ }

function testDailyReminderNow() {
  const report = dailyBillingAutomation_();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}

// ใช้ตรวจว่า Trigger/ค่าตั้งต้น/จำนวนบิลพร้อมทำงานหรือไม่ โดยไม่ส่งข้อความ
function diagnoseDailyReminder() {
  const config = getConfig_();
  const day = getBangkokDayOfMonth_(new Date());
  const bills = sheetToObjects_(getSheet_(SHEET_BILLS));
  const members = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS));
  const openActivity = bills.filter(function (b) { return String(b.status).toLowerCase() === 'open' && String(b.billType).toLowerCase() !== 'monthly'; });
  const openMonthly = bills.filter(function (b) { return String(b.status).toLowerCase() === 'open' && String(b.billType).toLowerCase() === 'monthly'; });
  const triggers = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'dailyBillingAutomation_'; });
  const result = {
    success: !!config.lineChannelAccessToken && !!config.lineGroupId && triggers.length >= 2,
    timezone: APP_TIMEZONE,
    bangkokDate: getBangkokDateKey_(new Date()),
    monthlyReminderWindow: day >= 23 && day <= 28,
    lineTokenConfigured: !!config.lineChannelAccessToken,
    lineGroupConfigured: !!config.lineGroupId,
    triggerCount: triggers.length,
    openActivityBills: openActivity.length,
    openMonthlyBills: openMonthly.length,
    unpaidMembers: members.filter(function (m) { return String(m.status).toLowerCase() !== 'paid'; }).length
  };
  Logger.log('REMINDER_DIAGNOSIS ' + JSON.stringify(result));
  return result;
}

function getBillWizardKey_(userId) { return 'BILL_WIZARD_' + String(userId || ''); }
function getBillWizard_(userId) {
  const raw = CacheService.getScriptCache().get(getBillWizardKey_(userId));
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { return null; }
}
function saveBillWizard_(userId, state) {
  CacheService.getScriptCache().put(getBillWizardKey_(userId), JSON.stringify(state), 1800);
}
function clearBillWizard_(userId) { CacheService.getScriptCache().remove(getBillWizardKey_(userId)); }

function startBillWizard_(userId, type) {
  if (!isLineAdmin_(userId)) return [lineText_('คำสั่งนี้สำหรับผู้ดูแลเท่านั้น')];
  const state = { type: type === 'monthly' ? 'monthly' : 'activity', stage: 'title', title: '', amount: 0, dueDate: '', dueDay: 28, selectedMemberIds: [] };
  saveBillWizard_(userId, state);
  return [lineText_((state.type === 'monthly' ? '📅 สร้างบิลรายเดือน' : '🎯 สร้างบิลกิจกรรม') + '\n\nกรุณาพิมพ์ชื่อรายการ\nหรือพิมพ์ “ยกเลิก” เพื่อออก')];
}

function handleBillWizardText_(command, source) {
  const state = getBillWizard_(source.userId);
  if (!state) return null;
  if (command === 'ยกเลิก') { clearBillWizard_(source.userId); return [lineText_('ยกเลิกการสร้างบิลแล้ว', lineMainQuickReply_())]; }
  if (state.stage === 'title') {
    if (command.length < 2) return [lineText_('ชื่อรายการสั้นเกินไป กรุณาพิมพ์ใหม่')];
    state.title = command.slice(0, 120); state.stage = 'amount'; saveBillWizard_(source.userId, state);
    return [lineText_('ระบุยอดเงิน “ต่อคน” เป็นตัวเลข เช่น 300')];
  }
  if (state.stage === 'amount') {
    const amount = Number(String(command).replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) return [lineText_('ยอดเงินไม่ถูกต้อง กรุณาพิมพ์ตัวเลขที่มากกว่า 0')];
    state.amount = amount;
    if (state.type === 'monthly') {
      state.stage = 'dueDay'; saveBillWizard_(source.userId, state);
      return [lineText_('เลือกวันครบกำหนดของทุกเดือน (23–28)', { items: [23,24,25,26,27,28].map(function (day) { return { type: 'action', action: { type: 'postback', label: 'วันที่ ' + day, data: 'action=wizardDueDay&day=' + day, displayText: 'วันที่ ' + day } }; }) })];
    }
    state.stage = 'dueDate'; saveBillWizard_(source.userId, state);
    return [lineText_('ระบุวันครบกำหนดรูปแบบ YYYY-MM-DD\nตัวอย่าง 2026-09-30')];
  }
  if (state.stage === 'dueDate') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(command) || isNaN(new Date(command + 'T00:00:00').getTime())) return [lineText_('วันที่ไม่ถูกต้อง กรุณาใช้รูปแบบ YYYY-MM-DD')];
    state.dueDate = command; state.stage = 'members'; saveBillWizard_(source.userId, state);
    return [buildWizardMemberSelection_(source.userId, 0)];
  }
  return [lineText_('กรุณาเลือกสมาชิกจากปุ่มในข้อความ หรือพิมพ์ “ยกเลิก”')];
}

function buildBillTypePicker_() {
  return { type: 'flex', altText: 'เลือกประเภทบิล', contents: { type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#0B3B60', contents: [{ type: 'text', text: 'สร้างบิลใหม่', color: '#FFFFFF', size: 'xl', weight: 'bold' }] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      linePostbackButton_('บิลกิจกรรม', 'action=startBillWizard&type=activity', '#7C3AED'),
      linePostbackButton_('บิลรายเดือน', 'action=startBillWizard&type=monthly', '#0D9488'),
      { type: 'text', text: 'บิลรายเดือนจะสร้างอัตโนมัติและแจ้งเตือนวันที่ 23–28 ของทุกเดือน', size: 'xs', color: '#64748B', wrap: true }
    ] }
  } };
}

function buildWizardMemberSelection_(userId, page) {
  const state = getBillWizard_(userId);
  if (!state) return lineText_('ขั้นตอนหมดอายุ กรุณาเริ่มสร้างบิลใหม่');
  const members = getActiveLineMembers_();
  const pageSize = 8;
  const maxPage = Math.max(0, Math.ceil(members.length / pageSize) - 1);
  page = Math.max(0, Math.min(maxPage, Number(page) || 0));
  const chosen = {};
  (state.selectedMemberIds || []).forEach(function (id) { chosen[String(id)] = true; });
  const bubbles = members.slice(page * pageSize, page * pageSize + pageSize).map(function (member) {
    const selected = !!chosen[String(member.id)];
    return { type: 'bubble', size: 'micro', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: (selected ? '✓ ' : '') + member.name, weight: 'bold', size: 'sm', wrap: true, color: selected ? '#047857' : '#334155' },
      linePostbackButton_(selected ? 'ยกเลิกเลือก' : 'เลือกคนนี้', 'action=wizardToggleMember&id=' + encodeURIComponent(member.id) + '&page=' + page, selected ? '#DC2626' : '#0D9488')
    ] } };
  });
  const controls = [];
  if (page > 0) controls.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: 'ก่อนหน้า', data: 'action=wizardMembers&page=' + (page - 1) } });
  if (page < maxPage) controls.push({ type: 'button', style: 'secondary', height: 'sm', action: { type: 'postback', label: 'ถัดไป', data: 'action=wizardMembers&page=' + (page + 1) } });
  bubbles.push({ type: 'bubble', size: 'micro', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
    { type: 'text', text: 'เลือกแล้ว ' + (state.selectedMemberIds || []).length + '/' + members.length + ' คน', weight: 'bold', size: 'sm', wrap: true },
    linePostbackButton_('เลือกทั้งหมด', 'action=wizardAllMembers&page=' + page, '#2563EB'),
    linePostbackButton_('ล้างที่เลือก', 'action=wizardClearMembers&page=' + page, '#64748B'),
    linePostbackButton_('ยืนยันสร้างบิล', 'action=wizardFinish', '#EA580C')
  ].concat(controls) } });
  return { type: 'flex', altText: 'เลือกสมาชิกสำหรับบิล', contents: { type: 'carousel', contents: bubbles } };
}

function finishBillWizard_(userId) {
  const state = getBillWizard_(userId);
  if (!state || state.stage !== 'members') return [lineText_('ขั้นตอนหมดอายุ กรุณาเริ่มใหม่')];
  if (!(state.selectedMemberIds || []).length) return [lineText_('กรุณาเลือกสมาชิกอย่างน้อย 1 คน'), buildWizardMemberSelection_(userId, 0)];
  let result;
  if (state.type === 'monthly') {
    result = withScriptLock_(function () { return createMonthlyPlan_({ title: state.title, amountPerMember: state.amount, billingDay: 23, dueDay: state.dueDay, memberIds: state.selectedMemberIds }); });
  } else {
    result = withScriptLock_(function () { return createBill_({ title: state.title, amountPerMember: state.amount, dueDate: state.dueDate, billType: 'activity', memberIds: state.selectedMemberIds, createdBy: userId }); });
  }
  if (result.success) clearBillWizard_(userId);
  return [lineText_(result.success ? '✅ สร้าง' + (state.type === 'monthly' ? 'แผนบิลรายเดือน' : 'บิลกิจกรรม') + 'เรียบร้อยแล้ว' + (result.id ? '\nรหัส: ' + result.id : '') : result.message, lineMainQuickReply_())];
}

function handleLineTextCommand_(text, source) {
  // This entry point must also stay safe when called directly by old code.
  if (!isLineMenuCommand_(text)) return [];
  return [buildLineMenuMessage_((source || {}).userId)];
}

function handleLinePostback_(data, source) {
  const params = parseLinePostback_(data);
  if(!['menu','syncMembers','prepareSlip'].includes(params.action))return [];
  if (params.action === 'menu') return [buildLineMenuMessage_(source.userId)];
  if (params.action === 'syncMembers') {
    if (!isLineAdmin_(source.userId)) return [lineText_('คำสั่งนี้สำหรับผู้ดูแลเท่านั้น')];
    const groupId = source.type === 'group' ? source.groupId : getConfig_().lineGroupId;
    if (!groupId) return [lineText_('ไม่พบ LINE_GROUP_ID')];
    try {
      const sync = withScriptLock_(function () { return syncLineMembersOrFallback_(groupId); });
      if (sync.mode === 'self-registration') return [buildLineRegistrationRequestMessage_()];
      const result = sync.result;
      return [lineText_('✅ ซิงก์สมาชิกแล้ว\nพบ ' + result.total + ' • เพิ่ม ' + result.created + ' • อัปเดต ' + result.updated + ' • ข้าม ' + result.skipped)];
    } catch (err) { return [lineText_('ซิงก์สมาชิกไม่สำเร็จ: ' + err.message)]; }
  }
  if (params.action === 'createbill') return isLineAdmin_(source.userId) ? [buildBillTypePicker_()] : [lineText_('คำสั่งนี้สำหรับผู้ดูแลเท่านั้น')];
  if (params.action === 'startBillWizard') return startBillWizard_(source.userId, params.type);
  if (params.action === 'wizardDueDay') {
    const state = getBillWizard_(source.userId); const day = Number(params.day);
    if (!state || state.stage !== 'dueDay' || day < 23 || day > 28) return [lineText_('ขั้นตอนไม่ถูกต้อง กรุณาเริ่มใหม่')];
    state.dueDay = day; state.stage = 'members'; saveBillWizard_(source.userId, state);
    return [buildWizardMemberSelection_(source.userId, 0)];
  }
  if (params.action === 'wizardMembers') return [buildWizardMemberSelection_(source.userId, params.page)];
  if (params.action === 'wizardToggleMember') {
    const state = getBillWizard_(source.userId); if (!state || state.stage !== 'members') return [lineText_('ขั้นตอนหมดอายุ กรุณาเริ่มใหม่')];
    const selected = state.selectedMemberIds || []; const index = selected.indexOf(params.id);
    if (index === -1) selected.push(params.id); else selected.splice(index, 1);
    state.selectedMemberIds = selected; saveBillWizard_(source.userId, state);
    return [buildWizardMemberSelection_(source.userId, params.page)];
  }
  if (params.action === 'wizardAllMembers') {
    const state = getBillWizard_(source.userId); if (!state) return [lineText_('ขั้นตอนหมดอายุ กรุณาเริ่มใหม่')];
    state.selectedMemberIds = getActiveLineMembers_().map(function (m) { return String(m.id); }); saveBillWizard_(source.userId, state);
    return [buildWizardMemberSelection_(source.userId, params.page)];
  }
  if (params.action === 'wizardClearMembers') {
    const state = getBillWizard_(source.userId); if (!state) return [lineText_('ขั้นตอนหมดอายุ กรุณาเริ่มใหม่')];
    state.selectedMemberIds = []; saveBillWizard_(source.userId, state); return [buildWizardMemberSelection_(source.userId, params.page)];
  }
  if (params.action === 'wizardFinish') return finishBillWizard_(source.userId);
  if (params.action === 'summary') return [buildLineFinanceMessage_()];
  if (params.action === 'bills') return buildLineOpenBillsMessages_(false);
  if (params.action === 'mybills') return buildLineMyBillsMessages_(source.userId);
  if (params.action === 'expenses') return [buildLineExpensesMessage_()];
  if (params.action === 'pay') return [buildLinePaymentMessage_(params.billId, source.userId)];
  if (params.action === 'prepareSlip') return prepareLineSlip_(source.userId, params.billId);
  if (params.action === 'remind') {
    if (!isLineAdmin_(source.userId)) return [lineText_('คำสั่งนี้สำหรับผู้ดูแลเท่านั้น')];
    const result = sendBillReminder_(params.billId);
    return [lineText_(result.success ? '✅ ส่งแจ้งเตือนแล้ว' : result.message)];
  }
  return [];
}

function isLineAdmin_(userId) {
  const ids = String(getConfig_().lineAdminUserIds || '').split(',').map(function (v) { return v.trim(); }).filter(Boolean);
  return !!userId && ids.indexOf(String(userId)) !== -1;
}

function getMemberByLineUserId_(userId) {
  return sheetToObjects_(getSheet_(SHEET_MEMBERS)).find(function (m) { return String(m.lineUserId || '') === String(userId || ''); }) || null;
}

function lineText_(text, quickReply) {
  const message = { type: 'text', text: String(text || '').slice(0, 5000) };
  if (quickReply) message.quickReply = quickReply;
  return message;
}

function linePostbackButton_(label, data, color) {
  const button = { type: 'button', style: 'primary', height: 'sm', action: { type: 'postback', label: label, data: data, displayText: label } };
  if (color) button.color = color;
  return button;
}

function lineUriButton_(label, uri, color) {
  const button = { type: 'button', style: 'primary', height: 'sm', action: { type: 'uri', label: label, uri: uri } };
  if (color) button.color = color;
  return button;
}

function buildLiffMenuUrl_(view) {
  const liffId = String(getConfig_().liffId || '').trim();
  return liffId ? 'https://liff.line.me/' + encodeURIComponent(liffId) + '?view=' + encodeURIComponent(view) : '';
}

function buildLiffBillUrl_(billId) {
  const liffId = String(getConfig_().liffId || '').trim();
  return liffId ? 'https://liff.line.me/' + encodeURIComponent(liffId) + '?billId=' + encodeURIComponent(String(billId || '')) : '';
}

function lineMainQuickReply_(){return {items:[['บิลของฉัน','my-bills'],['บิลทั้งหมด','open-bills'],['สรุปยอด','summary'],['รายจ่าย','expenses']].map(m=>({type:'action',action:{type:'uri',label:m[0],uri:buildLiffMenuUrl_(m[1])}}))};}

function buildLineMenuMessage_(userId,mood) {
  const menu=[['🧾 บิลของฉัน','my-bills'],['📣 บิลที่เรียกเก็บ','open-bills'],['💰 สรุปยอดเงิน','summary'],['🧺 ดูรายจ่าย','expenses'],['📚 ประวัติของฉัน','history'],['🐣 เล้าไก่ของฉัน','coop'],['🥚 ฟักไข่ประจำเดือน','hatch'],['⭐ คะแนนของฉัน','points']];
  if(isLineAdmin_(userId)) menu.push(['✨ สร้างบิล','create-bill'],['📅 แผนรายเดือน','plans'],['📤 บันทึกถอนเงิน','create-withdrawal'],['🔎 ตรวจสลิป','reviews'],['🔔 สถานะส่งเตือน','notifications'],['🐔 จัดการเกม','game-admin']);
  const petImage=gameLineImage_(userId,mood);
  return {type:'flex',altText:LINE_MENU_ALT_TEXT,contents:Object.assign({type:'bubble',header:{type:'box',layout:'vertical',backgroundColor:'#403129',contents:[{type:'text',text:'🐔 SEC1 • ไก่จิก',color:'#FFFFFF',weight:'bold',size:'xl'},{type:'text',text:'กดเมนูได้เลย ไม่ต้องพิมพ์ครับ',color:'#B5F5DD',size:'sm'}]},body:{type:'box',layout:'vertical',spacing:'sm',contents:menu.map(m=>lineUriButton_(m[0],buildLiffMenuUrl_(m[1]),'#A7442D'))}},petImage?{hero:petImage}:{})};
}

function buildLineFinanceMessage_() {
  const s = buildFinanceSummary_(sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)), sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)), sheetToObjects_(getSheet_(SHEET_BILLS)), sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)));
  function row(label, value, color) { return { type: 'box', layout: 'horizontal', contents: [{ type: 'text', text: label, color: '#64748B', size: 'sm', flex: 3 }, { type: 'text', text: Number(value).toLocaleString('th-TH') + ' บาท', color: color, size: 'sm', weight: 'bold', align: 'end', flex: 5 }] }; }
  return { type: 'flex', altText: 'สรุปยอดเงินกองกลาง', contents: { type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#0F766E', paddingAll: '18px', contents: [{ type: 'text', text: 'สรุปยอดเงิน', color: '#FFFFFF', size: 'xl', weight: 'bold' }] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [row('รับทั้งหมด', s.income, '#059669'), row('รายจ่าย', s.expenses, '#E11D48'), row('ถอนนำไปใช้', s.withdrawn, '#EA580C'), { type: 'separator' }, row('คงเหลือ', s.balance, '#1D4ED8'), row('ยอดค้างรับ', s.outstanding, '#D97706')] },
    footer: { type: 'box', layout: 'vertical', contents: [linePostbackButton_('กลับเมนู', 'action=menu', '#475569')] }
  } };
}

function buildLineOpenBillsMessages_(showNames) {
  const bills = sheetToObjects_(getSheet_(SHEET_BILLS)).filter(function (b) { return b.status === 'open'; });
  if (!bills.length) return [lineText_('✅ ไม่มีบิลที่เปิดค้างอยู่', lineMainQuickReply_())];
  const billMembers = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS));
  const bubbles = bills.slice(0, 10).map(function (bill) {
    const rows = billMembers.filter(function (m) { return String(m.billId) === String(bill.id); });
    const unpaid = rows.filter(function (m) { return m.status !== 'paid'; });
    const received = rows.filter(function (m) { return m.status === 'paid'; }).reduce(function (s, m) { return s + Number(m.amount || 0); }, 0);
    const body = [
      { type: 'text', text: bill.title, weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: 'ครบกำหนด ' + String(formatDateValue_(bill.dueDate)).substring(0, 10), size: 'xs', color: '#64748B', margin: 'sm' },
      { type: 'text', text: 'รับแล้ว ' + received.toLocaleString('th-TH') + ' / ' + Number(bill.totalExpected || 0).toLocaleString('th-TH') + ' บาท', size: 'sm', color: '#0F766E', weight: 'bold', margin: 'md' },
      { type: 'text', text: 'ชำระแล้ว ' + (rows.length - unpaid.length) + '/' + rows.length + ' คน', size: 'sm', color: '#334155', margin: 'sm' }
    ];
    if (showNames) body.push({ type: 'text', text: 'ค้าง: ' + (unpaid.map(function (m) { return m.memberName; }).join(', ') || 'ไม่มี'), size: 'xs', color: '#DC2626', wrap: true, margin: 'md' });
    return { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body }, footer: { type: 'box', layout: 'vertical', contents: [linePostbackButton_('แสดงบิลนี้เพื่อส่งสลิป', 'action=pay&billId=' + encodeURIComponent(bill.id), '#2563EB')] } };
  });
  return [{ type: 'flex', altText: 'บิลที่กำลังเรียกเก็บ', contents: { type: 'carousel', contents: bubbles } }];
}

function buildLineMyBillsMessages_(userId) {
  const member = getMemberByLineUserId_(userId);
  if (!member) return [lineText_('ยังไม่ได้ลงทะเบียน กรุณาพิมพ์\nลงทะเบียน ชื่อสมาชิก')];
  const billsById = {};
  sheetToObjects_(getSheet_(SHEET_BILLS)).forEach(function (b) { billsById[String(b.id)] = b; });
  const rows = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).filter(function (m) { return String(m.memberId) === String(member.id) && billsById[String(m.billId)] && billsById[String(m.billId)].status === 'open'; });
  if (!rows.length) return [lineText_('✅ ' + member.name + ' ไม่มีบิลค้างชำระ', lineMainQuickReply_())];
  const bubbles = rows.slice(0, 10).map(function (row) {
    const bill = billsById[String(row.billId)];
    return { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: [
      { type: 'text', text: bill.title, weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: Number(row.amount).toLocaleString('th-TH') + ' บาท', size: 'xl', color: '#D97706', weight: 'bold', margin: 'md' },
      { type: 'text', text: 'สถานะ: ' + (row.status === 'partial' ? 'ชำระบางส่วน' : 'ยังไม่ชำระ'), size: 'sm', color: '#DC2626' },
      { type: 'text', text: 'ครบกำหนด ' + String(formatDateValue_(bill.dueDate)).substring(0, 10), size: 'xs', color: '#64748B' }
    ] }, footer: { type: 'box', layout: 'vertical', contents: [linePostbackButton_('แสดงบิลนี้เพื่อส่งสลิป', 'action=pay&billId=' + encodeURIComponent(bill.id), '#0D9488')] } };
  });
  return [{ type: 'flex', altText: 'บิลค้างชำระของ ' + member.name, contents: { type: 'carousel', contents: bubbles } }];
}

function buildLineExpensesMessage_() {
  const txns = sheetToObjects_(getSheet_(SHEET_TRANSACTIONS)).filter(function (t) { return Number(t.amount) < 0; }).sort(function (a,b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 10);
  const withdrawals = sheetToObjects_(getSheet_(SHEET_WITHDRAWALS)).sort(function (a,b) { return String(b.date).localeCompare(String(a.date)); }).slice(0, 10);
  const lines = txns.map(function (t) { return '• ' + String(formatDateValue_(t.date)).substring(0,10) + ' ' + (t.note || t.memberName) + ' — ' + Math.abs(Number(t.amount)).toLocaleString('th-TH') + ' บาท'; })
    .concat(withdrawals.map(function (w) { return '• ' + String(formatDateValue_(w.date)).substring(0,10) + ' ถอน: ' + w.purpose + ' — ' + Number(w.amount).toLocaleString('th-TH') + ' บาท'; }));
  return lineText_('🧾 รายจ่ายและยอดถอนล่าสุด\n' + (lines.join('\n') || 'ยังไม่มีรายการ'), lineMainQuickReply_());
}

function buildLinePaymentMessage_(billId, userId) {
  const member = getMemberByLineUserId_(userId);
  if (!member) return lineText_('กรุณาลงทะเบียนก่อน โดยพิมพ์\nลงทะเบียน ชื่อสมาชิก');
  const billFound = findObjectByField_(getSheet_(SHEET_BILLS), 'id', billId);
  const row = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).find(function (m) {
    return String(m.billId) === String(billId) && String(m.memberId) === String(member.id) && m.status !== 'paid';
  });
  if (!billFound || !row) return lineText_('ไม่พบบิลค้างชำระของคุณ หรือบิลนี้ชำระแล้ว');
  const config = getConfig_();
  const fallbackSeparator = config.webAppUrl.indexOf('?') === -1 ? '?' : '&';
  const fallbackUrl = config.webAppUrl ? config.webAppUrl + fallbackSeparator + 'billId=' + encodeURIComponent(billId) + '&memberId=' + encodeURIComponent(member.id) : '';
  const uploadUrl = config.liffId
    ? 'https://liff.line.me/' + encodeURIComponent(config.liffId) + '?billId=' + encodeURIComponent(billId) + '&memberId=' + encodeURIComponent(member.id)
    : fallbackUrl;
  const footer = [
    { type: 'button', style: 'secondary', height: 'sm', action: { type: 'clipboard', label: 'คัดลอกเลขบัญชี', clipboardText: config.bankAccountNo } },
    linePostbackButton_('ส่งรูปสลิปใน LINE', 'action=prepareSlip&billId=' + encodeURIComponent(billId), '#0D9488')
  ];
  if (uploadUrl) footer.unshift({ type: 'button', style: 'primary', color: '#2563EB', height: 'sm', action: { type: 'uri', label: 'เปิดหน้าอัปโหลดสลิป', uri: uploadUrl } });
  return { type: 'flex', altText: 'ข้อมูลชำระเงิน ' + billFound.object.title, contents: { type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: '#0B3B60', paddingAll: '18px', contents: [{ type: 'text', text: 'ข้อมูลชำระเงิน', color: '#FFFFFF', size: 'xl', weight: 'bold' }] },
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: [
      { type: 'text', text: billFound.object.title, weight: 'bold', size: 'lg', wrap: true },
      { type: 'text', text: Math.max(0, Number(row.amount || 0) - Number(row.paidAmount || 0)).toLocaleString('th-TH') + ' บาท', weight: 'bold', size: 'xxl', color: '#D97706' },
      { type: 'separator' },
      { type: 'text', text: config.bankName, size: 'sm', color: '#334155' },
      { type: 'text', text: config.bankAccountNo, size: 'xl', weight: 'bold', color: '#1D4ED8' },
      { type: 'text', text: config.bankAccountName, size: 'sm', color: '#334155' },
      { type: 'text', text: 'ครบกำหนด ' + String(formatDateValue_(billFound.object.dueDate)).substring(0, 10), size: 'xs', color: '#64748B' }
    ] }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footer }
  } };
}

function prepareLineSlip_(userId, billId) {
  const member = getMemberByLineUserId_(userId);
  if (!member) return [lineText_('กรุณาลงทะเบียนก่อน โดยพิมพ์\nลงทะเบียน ชื่อสมาชิก')];
  const row = sheetToObjects_(getSheet_(SHEET_BILL_MEMBERS)).find(function (m) { return String(m.billId) === String(billId) && String(m.memberId) === String(member.id) && m.status !== 'paid'; });
  if (!row) return [lineText_('ไม่พบบิลค้างชำระของคุณ หรือบิลนี้ชำระแล้ว')];
  CacheService.getScriptCache().put('LINE_PAY_' + userId, String(billId), 600);
  return [lineText_('📷 พร้อมรับสลิปสำหรับ\n' + member.name + '\nยอด ' + Number(row.amount).toLocaleString('th-TH') + ' บาท\n\nกรุณาส่ง “รูปภาพสลิป” ภายใน 10 นาที')];
}

function handleLineImage_(messageId, source) {
  // An ordinary photo is not a slip request. Require an explicit bill selection first.
  const pending = CacheService.getScriptCache();
  const selected = source.userId && pending.get('LINE_PAY_' + source.userId);
  if (!selected) return [];
  const member=getMemberByLineUserId_(source.userId);
  if(!member) return [lineText_('กรุณาลงทะเบียนก่อน')];
  const open=secRows_('Bills').filter(b=>b.status==='open').map(b=>String(b.id));
  const rows=secRows_('BillMembers').filter(r=>String(r.memberId)===String(member.id)&&open.indexOf(String(r.billId))>=0&&secRemaining_(r)>0);
  const row=rows.find(r=>String(r.billId)===String(selected));
  if(!row) {
    pending.remove('LINE_PAY_' + source.userId);
    return [lineText_('บิลที่เลือกไม่เปิดรับสลิปแล้ว กรุณาตรวจบิลของฉันอีกครั้งครับ')];
  }
  try {
    const response=UrlFetchApp.fetch('https://api-data.line.me/v2/bot/message/'+encodeURIComponent(messageId)+'/content',{headers:{Authorization:'Bearer '+getConfig_().lineChannelAccessToken},muteHttpExceptions:true});
    if(response.getResponseCode()!==200) throw Error('ดาวน์โหลดรูปไม่สำเร็จ');
    const blob=response.getBlob();
    const uploaded=secUpload_({userId:source.userId}, {billId:row.billId,requestId:'line_'+messageId,imageBase64:Utilities.base64Encode(blob.getBytes()),mimeType:blob.getContentType()});
    pending.remove('LINE_PAY_' + source.userId);
    return [lineText_('🔎 รับหลักฐานแล้ว พิมพ์ เมนู หรือ sec1 แล้วเปิดบิลของฉันเพื่อตรวจยอดและส่งให้ Admin ยืนยันเงินเข้า รหัส '+uploaded.id)];
  }catch(err){return [lineText_(err.message)];}
}

function replyLineMessages_(replyToken, messages) {
  const config = getConfig_();
  if (!config.lineChannelAccessToken) {
    Logger.log('SEC1_LINE_REPLY_FAILED: ไม่พบ LINE_CHANNEL_ACCESS_TOKEN');
    return { success: false, statusCode: 0, message: 'ไม่พบ LINE_CHANNEL_ACCESS_TOKEN' };
  }
  const cleanMessages = (messages || []).filter(Boolean).slice(0, 5);
  if (!cleanMessages.length) return { success: false, statusCode: 0, message: 'ไม่มีข้อความตอบกลับ' };
  const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + config.lineChannelAccessToken },
    payload: JSON.stringify({ replyToken: replyToken, messages: cleanMessages }),
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  const responseBody = String(response.getContentText() || '').slice(0, 1000);
  if (code < 200 || code >= 300) {
    Logger.log('SEC1_LINE_REPLY_FAILED HTTP ' + code + ': ' + responseBody);
    return { success: false, statusCode: code, message: responseBody || 'LINE reply failed' };
  }
  Logger.log('SEC1_LINE_REPLY_OK HTTP ' + code + ' messages=' + cleanMessages.length);
  return { success: true, statusCode: code };
}

/** ตรวจ Channel access token และค่าหลัก โดยไม่ส่งข้อความ */
function diagnoseLineBot() {
  const config = getConfig_();
  const properties = PropertiesService.getScriptProperties();
  const report = {
    success: false,
    menuPolicy: LINE_MENU_POLICY,
    lineTokenConfigured: !!config.lineChannelAccessToken,
    lineGroupConfigured: !!config.lineGroupId,
    lineGroupIdLooksValid: /^C[0-9a-f]{32}$/i.test(String(config.lineGroupId || '')),
    liffId: config.liffId,
    adminCount: String(config.lineAdminUserIds || '').split(',').map(function (id) {
      return id.trim();
    }).filter(Boolean).length,
    webhookKeyConfigured: !!properties.getProperty('LINE_WEBHOOK_KEY'),
    botInfoHttpCode: 0,
    botDisplayName: '',
    error: ''
  };
  try {
    if (!config.lineChannelAccessToken) throw new Error('ไม่พบ LINE_CHANNEL_ACCESS_TOKEN');
    const response = UrlFetchApp.fetch('https://api.line.me/v2/bot/info', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + config.lineChannelAccessToken },
      muteHttpExceptions: true
    });
    report.botInfoHttpCode = response.getResponseCode();
    let body = {};
    try { body = JSON.parse(response.getContentText() || '{}'); } catch (ignore) {}
    report.botDisplayName = String(body.displayName || '');
    if (report.botInfoHttpCode !== 200) {
      throw new Error('LINE API HTTP ' + report.botInfoHttpCode + ': ' +
        String(body.message || 'ตรวจ Token ไม่สำเร็จ'));
    }
    if (!report.lineGroupConfigured) throw new Error('ยังไม่ได้ตั้ง LINE_GROUP_ID');
    if (!report.lineGroupIdLooksValid) throw new Error('รูปแบบ LINE_GROUP_ID ไม่ถูกต้อง');
    if (!report.webhookKeyConfigured) throw new Error('ยังไม่มี LINE_WEBHOOK_KEY ให้รัน setupSec1V2()');
    report.success = true;
  } catch (error) {
    report.error = error && error.message ? error.message : String(error);
  }
  Logger.log('SEC1_LINE_DIAGNOSIS ' + JSON.stringify(report));
  return report;
}

/** ส่ง Flex Menu จริงเข้ากลุ่ม ใช้หลัง diagnoseLineBot() สำเร็จ */
function testLineMenuToGroup() {
  const diagnosis = diagnoseLineBot();
  if (!diagnosis.success) throw new Error(diagnosis.error || 'การตั้งค่า LINE ยังไม่พร้อม');
  const result = sendLineGroupMessages_([buildLineMenuMessage_('')]);
  Logger.log('SEC1_LINE_MENU_TEST ' + JSON.stringify(result));
  if (!result.success) throw new Error('ส่งเมนูทดสอบไม่สำเร็จ: ' + result.message);
  return result;
}

// ================= SEC1 V2 =================
// Install: setupSec1V2(), then setupMonthlyLineTrigger().
// Webhook URL: /exec?key=<LINE_WEBHOOK_KEY> (private Script Property).
// LIFF endpoint: https://jirayut-sa.github.io/slip/liff.html
// LINE_LOGIN_CHANNEL_ID required; LINE_ADMIN_USER_IDS supports comma-separated IDs.
// OCR is transcription only. Admin must verify bank receipt before approval.
const SEC_SLIPS=['id','requestId','userId','memberId','memberName','billId','amount','date','reference','imageHash','fileId','proofUrl','ocr','status','note','createdAt','reviewedBy','reviewedAt','transactionId','bankPaidAt'];
const SEC_LOG=['id','billId','day','channel','target','status','attempts','retryKey','httpCode','message','updatedAt','payload','firstAttemptAt'];
const SEC_REQUEST=['id','userId','action','result','createdAt'];
/**
 * ติดตั้งโครงสร้าง SEC1 v2 แบบแสดงชื่อขั้นตอนเมื่อเกิดปัญหา
 * ฟังก์ชันนี้รันซ้ำได้ และไม่ลบข้อมูลเดิม
 */
function setupSec1V2() {
  var result = {
    success: false,
    startedAt: new Date().toISOString(),
    completedSteps: []
  };

  try {
    var properties = PropertiesService.getScriptProperties();
    var sheetId = String(properties.getProperty('SHEET_ID') || '').trim();
    var folderId = String(properties.getProperty('DRIVE_FOLDER_ID') || '').trim();
    if (!sheetId) throw new Error('[SCRIPT_PROPERTIES] ไม่พบ SHEET_ID');
    if (!folderId) throw new Error('[SCRIPT_PROPERTIES] ไม่พบ DRIVE_FOLDER_ID');
    result.completedSteps.push('SCRIPT_PROPERTIES');

    // เปิดบริการทั้งสองก่อน เพื่อให้ Google แสดงหน้าขอสิทธิ์ตั้งแต่การติดตั้ง
    REQUEST_SPREADSHEET_ = null;
    var spreadsheet = SpreadsheetApp.openById(sheetId);
    spreadsheet.getName();
    result.completedSteps.push('OPEN_SPREADSHEET');

    var folder = DriveApp.getFolderById(folderId);
    folder.getName();
    result.completedSteps.push('OPEN_DRIVE_FOLDER');

    var definitions = [
      [SHEET_MEMBERS, MEMBER_HEADERS],
      [SHEET_TRANSACTIONS, TRANSACTION_HEADERS],
      [SHEET_SKIPPED_MONTHS, SKIPPED_MONTH_HEADERS],
      [SHEET_ACTIVITIES, ACTIVITY_HEADERS],
      [SHEET_BILLS, BILL_HEADERS],
      [SHEET_BILL_MEMBERS, BILL_MEMBER_HEADERS],
      [SHEET_MONTHLY_PLANS, MONTHLY_PLAN_HEADERS],
      [SHEET_WITHDRAWALS, WITHDRAWAL_HEADERS.concat(['clientRequestId'])],
      ['PaymentReviews', SEC_SLIPS],
      ['NotificationLog', SEC_LOG],
      ['RequestLedger', SEC_REQUEST]
    ];

    for (var index = 0; index < definitions.length; index++) {
      var name = definitions[index][0];
      var headers = definitions[index][1];
      var sheet = spreadsheet.getSheetByName(name);
      if (!sheet) sheet = spreadsheet.insertSheet(name);
      ensureHeaders_(sheet, headers);
      sheet.setFrozenRows(1);
      SpreadsheetApp.flush();
      result.completedSteps.push('SHEET_' + name);
    }

    if (!properties.getProperty('LINE_WEBHOOK_KEY')) {
      properties.setProperty('LINE_WEBHOOK_KEY', Utilities.getUuid() + Utilities.getUuid());
    }
    result.completedSteps.push('WEBHOOK_KEY');
    result.success = true;
    result.finishedAt = new Date().toISOString();
    Logger.log('SEC1_SETUP_RESULT ' + JSON.stringify(result));
    Logger.log('ติดตั้งสำเร็จ ขั้นต่อไปให้รัน setupMonthlyLineTrigger()');
    return result;
  } catch (error) {
    result.error = error && error.message ? error.message : String(error);
    result.finishedAt = new Date().toISOString();
    Logger.log('SEC1_SETUP_FAILED ' + JSON.stringify(result));
    throw new Error(
      'ติดตั้ง SEC1 ไม่สำเร็จหลังขั้นตอน [' +
      result.completedSteps.join(', ') + '] : ' + result.error
    );
  }
}

/** ตรวจเฉพาะ Properties และสิทธิ์ Google โดยไม่สร้าง/แก้ชีต */
function diagnoseSec1Setup() {
  var properties = PropertiesService.getScriptProperties();
  var report = {
    success: false,
    sheetIdConfigured: !!properties.getProperty('SHEET_ID'),
    driveFolderIdConfigured: !!properties.getProperty('DRIVE_FOLDER_ID'),
    spreadsheetAccessible: false,
    driveFolderAccessible: false,
    error: ''
  };
  try {
    if (!report.sheetIdConfigured) throw new Error('ไม่พบ SHEET_ID');
    if (!report.driveFolderIdConfigured) throw new Error('ไม่พบ DRIVE_FOLDER_ID');
    SpreadsheetApp.openById(properties.getProperty('SHEET_ID')).getName();
    report.spreadsheetAccessible = true;
    DriveApp.getFolderById(properties.getProperty('DRIVE_FOLDER_ID')).getName();
    report.driveFolderAccessible = true;
    report.success = true;
  } catch (error) {
    report.error = error && error.message ? error.message : String(error);
  }
  Logger.log('SEC1_SETUP_DIAGNOSIS ' + JSON.stringify(report));
  return report;
}
function secRows_(name){return sheetToObjects_(getSheet_(name));}
function secAppend_(name,headers,value){const sheet=getSheet_(name);appendRowByHeaders_(sheet,ensureHeaders_(sheet,headers),value);}
function secFind_(name,id){const r=findObjectByField_(getSheet_(name),'id',id);return r?r.object:null;}
function secUpdate_(name,id,changes){return updateObjectField_(getSheet_(name),'id',id,changes);}
function secHash_(text){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8)).replace(/=+$/,'');}
function secMoney_(n){const v=Number(n);if(!Number.isFinite(v)||v<=0||Math.abs(v*100-Math.round(v*100))>0.00001)throw Error('ระบุจำนวนเงินมากกว่า 0 ไม่เกินสองตำแหน่งทศนิยม');return Math.round(v*100)/100;}
function secRemaining_(r){return Math.max(0,Math.round((Number(r.amount||0)-Number(r.paidAmount||0))*100)/100);}
function secDate_(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(String(s)))throw Error('วันที่ไม่ถูกต้อง');const d=new Date(s+'T12:00:00+07:00');if(isNaN(d)||getBangkokDateKey_(d)!==s)throw Error('วันที่ไม่มีอยู่จริง');return d.toISOString();}
function secAdmin_(session){if(!session.isAdmin)throw Error('เฉพาะ Admin เท่านั้น');}
function secAuth_(token,fresh){
  token=String(token||'');if(!token)throw Error('กรุณาเข้าสู่ระบบ LINE');
  const channel=PropertiesService.getScriptProperties().getProperty('LINE_LOGIN_CHANNEL_ID');
  if(!channel)throw Error('Admin ต้องตั้ง LINE_LOGIN_CHANNEL_ID ใน Script Properties');
  const key='SEC_AUTH_'+secHash_(channel+':'+token),cache=CacheService.getScriptCache();
  let profile=fresh?null:cacheGetJson_(key);
  if(!profile){
    const v=UrlFetchApp.fetch('https://api.line.me/oauth2/v2.1/verify?access_token='+encodeURIComponent(token),{muteHttpExceptions:true});
    const info=JSON.parse(v.getContentText()||'{}');
    if(v.getResponseCode()!==200||String(info.client_id)!==String(channel)||Number(info.expires_in)<=0)throw Error('สิทธิ์ LINE หมดอายุหรือผิด Channel กรุณาเปิดใหม่');
    const r=UrlFetchApp.fetch('https://api.line.me/v2/profile',{headers:{Authorization:'Bearer '+token},muteHttpExceptions:true});
    profile=JSON.parse(r.getContentText()||'{}');if(r.getResponseCode()!==200||!profile.userId)throw Error('ตรวจ LINE ไม่สำเร็จ');
    cachePutJson_(key,profile,Math.max(1,Math.min(900,Number(info.expires_in))));
  }
  const member=getMemberByLineUserId_(profile.userId);
  if(!member&&!isLineAdmin_(profile.userId))throw Error('ยังไม่พบสมาชิก กรุณาพิมพ์ เมนู ในกลุ่มที่เชื่อมกับระบบเพื่อผูกสมาชิกก่อน');
  if(member&&String(member.status).toLowerCase()==='inactive')throw Error('สมาชิกนี้ถูกปิดใช้งาน');
  return makeLiffSession_(profile,member);
}
function secDispatch_(b){
  const actions=['secRead','secUpload','secSubmit','secReview','secWithdraw','secCreate','secStopPlan','secRemind','gameHatch','gameProfile','gameSaveSeason','gameRepair','gameVerifyTime'];
  if(actions.indexOf(b.action)<0)throw Error('กรุณาใช้เว็บ SEC1 รุ่นใหม่');
  const session=secAuth_(b.accessToken,b.action==='secReview'||b.action==='secWithdraw');
  if(b.action==='secRead')return {success:true,session:session,data:secRead_(session,b),updatedAt:new Date().toISOString()};
  if(b.action==='secUpload')return Object.assign({success:true},secUpload_(session,b));
  return withScriptLock_(function(){
    if(b.action==='gameHatch')return gameHatch_(session,b);
    if(b.action==='gameProfile')return gameProfile_(session,b);
    if(b.action==='gameSaveSeason')return gameSaveSeason_(session,b);
    if(b.action==='gameVerifyTime')return gameVerifyTime_(session,b);
    if(b.action==='gameRepair'){secAdmin_(session);return gameRepair_();}
    if(b.action==='secSubmit')return secSubmit_(session,b);
    if(b.action==='secReview')return secReview_(session,b);
    secAdmin_(session);
    if(b.action==='secRemind')return Object.assign({},secNotifyBill_(b.billId),{success:true});
    return secOnce_(session,b,function(){
      if(b.action==='secWithdraw')return secWithdraw_(session,b);
      if(b.action==='secStopPlan')return deleteMonthlyPlan_(b.id);
      if(b.action==='secCreate'){
        secMoney_(b.amountPerMember);
        if(String(b.title||'').length>100)throw Error('ชื่อบิลยาวเกิน 100 ตัวอักษร');
        if(!String(b.title||'').trim())throw Error('กรุณาระบุชื่อบิล');
        if(!Array.isArray(b.memberIds)||!b.memberIds.length)throw Error('เลือกสมาชิกอย่างน้อยหนึ่งคน');
        if(b.billType==='monthly'){if(!Number.isInteger(Number(b.dueDay))||Number(b.dueDay)<23||Number(b.dueDay)>28)throw Error('วันครบกำหนดรายเดือนต้องเป็น 23–28');return createMonthlyPlan_(b);}
        secDate_(b.dueDate);return createBill_(Object.assign({},b,{createdBy:session.userId,billType:'activity',_billId:'bill_'+secHash_(session.userId+':'+b.requestId)}));
      }
      throw Error('ไม่รู้จักคำสั่ง');
    });
  });
}
function secOnce_(session,b,fn){
  if(!/^[a-zA-Z0-9_-]{8,150}$/.test(String(b.requestId||'')))throw Error('ไม่พบรหัสคำขอ');
  const id=secHash_(session.userId+':'+b.action+':'+b.requestId),old=secFind_('RequestLedger',id);
  if(old){if(old.result)return JSON.parse(old.result);throw Error('รายการนี้กำลังทำงานหรือรอตรวจสอบ ห้ามส่งซ้ำ กรุณาติดต่อ Admin');}
  secAppend_('RequestLedger',SEC_REQUEST,{id:id,userId:session.userId,action:b.action,createdAt:new Date().toISOString()});
  const r=fn();secUpdate_('RequestLedger',id,{result:JSON.stringify(r)});return r;
}
function secRead_(session,b){
  const view=String(b.view||'my-bills'),page=Math.max(1,Math.floor(Number(b.page)||1));
  if(['coop','hatch','points','game-admin'].includes(view))return gameRead_(session,b);
  if(['plans','reviews','notifications'].indexOf(view)>=0)secAdmin_(session);
  if(view==='plans')return {history:paginateLiff_(secRows_('MonthlyPlans').map(p=>Object.assign({},p,{nextRun:p.status==='active'?'รอบวันที่ 23–28 ของเดือน':'หยุดแล้ว'})),page)};
  if(view==='notifications')return {history:paginateLiff_(secRows_('NotificationLog').reverse(),page),diagnosis:diagnoseDailyReminder(),lastRun:JSON.parse(PropertiesService.getScriptProperties().getProperty('SEC1_LAST_RUN')||'null')};
  if(view==='reviews'){const bills=secRows_('Bills');return {history:paginateLiff_(secRows_('PaymentReviews').filter(r=>r.status==='pending'||r.status==='posting').reverse().map(r=>Object.assign({},r,{billTitle:(bills.find(b=>b.id===r.billId)||{}).title||r.billId})),page)};}
  if(view==='history')return {history:paginateLiff_(secRows_('Transactions').filter(r=>r.memberId?String(r.memberId)===String(session.memberId):String(r.memberName)===String(session.memberName)).reverse().map(r=>({id:r.id,title:r.note||'ชำระเงิน',amount:r.amount,date:formatDateValue_(r.date)})),page)};
  if(view==='bill-detail'){const bill=secFind_('Bills',b.billId);if(!bill)throw Error('ไม่พบบิล');const rows=secRows_('BillMembers').filter(r=>r.billId===b.billId);return {bill:compactBillForLiff_(bill,rows),members:rows.map(r=>({memberName:r.memberName,amount:r.amount,paidAmount:r.paidAmount,status:r.status})),canPay:rows.some(r=>r.memberId===session.memberId)};}
  const allowed=['summary','expenses','my-bills','open-bills','payment','create-bill','create-withdrawal'];
  if(allowed.indexOf(view)<0)throw Error('ไม่พบเมนู');
  const data=buildLiffViewPayload_(view,page,b.billId,session);
  if(view==='my-bills'||view==='payment')data.submissions=secRows_('PaymentReviews').filter(r=>String(r.userId)===String(session.userId)&&['draft','pending','posting','rejected'].indexOf(r.status)>=0).map(r=>({id:r.id,billId:r.billId,status:r.status,note:r.note,amount:r.amount,date:r.date,ocr:r.ocr}));
  return data;
}
function secImage_(b){
  const mime=String(b.mimeType||'image/jpeg');if(['image/jpeg','image/png','image/webp'].indexOf(mime)<0)throw Error('รองรับภาพ JPEG PNG WebP');
  const base64=String(b.imageBase64||'').split(',').pop();if(!base64||base64.length>6000000)throw Error('ขนาดรูปต้องไม่เกิน 4.5 MB');
  const bytes=Utilities.base64Decode(base64);if(!bytes.length||bytes.length>4500000)throw Error('รูปไม่ถูกต้อง');
  const hash=Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes)).replace(/=+$/,'');
  return {bytes:bytes,mime:mime,base64:base64,hash:hash};
}
function secUpload_(session,b){
  const assigned=getLiffBillAssignment_({userId:session.userId},b.billId),img=secImage_(b);
  const id='proof_'+secHash_(session.userId+':'+String(b.requestId||img.hash));
  const reserved=withScriptLock_(function(){
    const old=secFind_('PaymentReviews',id);if(old)return old;
    if(secRows_('PaymentReviews').some(r=>r.imageHash===img.hash&&r.status!=='failed'))throw Error('รูปนี้เคยส่งแล้ว กรุณาดูประวัติหรือให้ Admin ตรวจรายการเดิม');
    secAppend_('PaymentReviews',SEC_SLIPS,{id:id,requestId:b.requestId,userId:session.userId,memberId:assigned.member.id,memberName:assigned.member.name,billId:b.billId,imageHash:img.hash,status:'uploading',createdAt:new Date().toISOString()});
    return null;
  });
  if(reserved){if(reserved.status==='uploading')throw Error('รูปนี้กำลังประมวลผล กรุณารอสักครู่');if(reserved.status==='failed')throw Error('อัปโหลดเดิมไม่สำเร็จ กรุณาเปิดบิลใหม่แล้วเลือกรูปอีกครั้ง');return reserved;}
  let file;
  try{
    file=DriveApp.getFolderById(getConfig_().driveFolderId).createFile(Utilities.newBlob(img.bytes,img.mime,id+'.jpg'));
    secUpdate_('PaymentReviews',id,{fileId:file.getId(),proofUrl:file.getUrl()});
    let ocr;try{ocr=ocrSlip_(img.base64,img.mime);}catch(e){ocr={success:false,message:'อ่านอัตโนมัติไม่ได้ กรุณากรอกตามหลักฐาน'};}
    const parsed=ocr.data||ocr.parsed||{};
    secUpdate_('PaymentReviews',id,{status:'draft',ocr:JSON.stringify(parsed),amount:Number(parsed.amount)||secRemaining_(assigned.assignment),date:parsed.date||getBangkokDateKey_(new Date()),reference:String(parsed.referenceNo||'').trim(),note:'OCR เป็นการอ่านข้อมูล โปรดให้ Admin ยืนยันเงินเข้า'});
    return secFind_('PaymentReviews',id);
  }catch(e){secUpdate_('PaymentReviews',id,{status:file?'draft':'failed',note:e.message});throw e;}
}
function secSubmit_(session,b){
  const r=secFind_('PaymentReviews',b.id);if(!r||r.userId!==session.userId)throw Error('ไม่พบหลักฐานของคุณ');
  if(['pending','approved','posting'].indexOf(r.status)>=0)return {success:true,status:r.status,id:r.id};
  if(r.status!=='draft'||!r.fileId)throw Error('หลักฐานยังไม่พร้อม');
  const assigned=getLiffBillAssignment_({userId:session.userId},r.billId),amount=secMoney_(b.amount);secDate_(b.date);
  if(amount>secRemaining_(assigned.assignment))throw Error('ยอดเกินยอดค้าง กรุณาตรวจสอบ');
  secUpdate_('PaymentReviews',r.id,{amount:amount,date:b.date,status:'pending',note:String(b.note||'').slice(0,500)});
  return {success:true,status:'pending',id:r.id};
}
function secReview_(session,b){
  secAdmin_(session);const r=secFind_('PaymentReviews',b.id);if(!r)throw Error('ไม่พบรายการ');
  if(r.status==='approved'||r.status==='rejected'){if(r.status==='approved')gameAwardSafe_(r.memberId,r.billId);return {success:true,status:r.status};}
  if(r.status!=='pending'&&r.status!=='posting')throw Error('รายการยังไม่พร้อมตรวจ');
  if(b.decision==='reject'){
    if(r.status==='posting')throw Error('รายการกำลังลงบัญชี กรุณาตรวจ Transactions ก่อน');
    if(!String(b.reason||'').trim())throw Error('ระบุเหตุผลที่ไม่ผ่าน');
    secUpdate_('PaymentReviews',r.id,{status:'rejected',note:String(b.reason).slice(0,500),reviewedBy:session.userId,reviewedAt:new Date().toISOString()});
    secPushOnce_('rejected_'+r.id,'personal',r.userId,[lineText_('🥺 หลักฐานยังไม่ผ่าน: '+String(b.reason).slice(0,500)+'\nกรุณาเปิดบิลแล้วส่งหลักฐานใหม่'),buildLineMenuMessage_(r.userId)]);
    return {success:true,status:'rejected'};
  }
  if(b.decision!=='approve'||b.bankConfirmed!==true)throw Error('ต้องยืนยันตรวจยอดเข้าจากธนาคารก่อน');
  const bankPaidAt=r.bankPaidAt||(b.bankPaidAt?gameBankTime_(b.bankPaidAt):'');
  const ref=String(b.reference||r.reference||'').trim();if(!ref)throw Error('ต้องระบุเลขอ้างอิงที่ตรวจจากธนาคาร');
  const tx=secRows_('Transactions'),txId='sec_'+r.id;
  if(tx.some(t=>String(t.ocrReferenceNo||'')===ref&&String(t.id)!==txId))throw Error('เลขอ้างอิงนี้ลงบัญชีแล้ว');
  const bill=secFind_('Bills',r.billId),assignment=secRows_('BillMembers').find(m=>String(m.billId)===String(r.billId)&&String(m.memberId)===String(r.memberId));
  const existing=tx.find(t=>t.id===txId);
  if(!existing){
    if(!bill||bill.status!=='open'||!assignment)throw Error('บิลปิดหรือไม่พบสมาชิกในบิล');
    const amount=secMoney_(r.amount);if(amount>secRemaining_(assignment))throw Error('ยอดเกินยอดค้างล่าสุด');
    secUpdate_('PaymentReviews',r.id,{status:'posting',reference:ref,bankPaidAt:bankPaidAt});
    secAppend_('Transactions',TRANSACTION_HEADERS,{id:txId,type:'deposit',memberId:r.memberId,memberName:r.memberName,slipOwnerName:r.memberName,amount:amount,date:secDate_(r.date),note:'ชำระ '+bill.title,slipUrl:r.proofUrl,createdAt:new Date().toISOString(),billId:r.billId,ocrReferenceNo:ref,clientRequestId:r.id,nameMatchStatus:'admin-bank-confirmed'});
  }
  // Recompute from committed ledger: retry cannot increment paidAmount twice.
  const paid=secRows_('Transactions').filter(t=>String(t.billId)===String(r.billId)&&(t.memberId?String(t.memberId)===String(r.memberId):String(t.memberName)===String(r.memberName))&&Number(t.amount)>0).reduce((a,t)=>a+Number(t.amount),0);
  if(!assignment)throw Error('ไม่พบสมาชิก ต้องให้ Admin ตรวจข้อมูล');
  secUpdate_('BillMembers',assignment.id,{paidAmount:Math.round(paid*100)/100,status:Math.round(paid*100)>=Math.round(Number(assignment.amount)*100)?'paid':'partial',transactionId:txId,paidAt:new Date().toISOString()});
  refreshBillStatus_(r.billId);
  secUpdate_('PaymentReviews',r.id,{status:'approved',reference:ref,bankPaidAt:bankPaidAt,reviewedBy:session.userId,reviewedAt:new Date().toISOString(),transactionId:txId});
  const award=gameAwardSafe_(r.memberId,r.billId);
  secPushOnce_('paid_'+r.id,'personal',r.userId,[lineText_('🥳 ไก่จิกได้รับการยืนยันแล้ว! '+r.memberName+' ชำระ '+Number(r.amount).toLocaleString('th-TH')+' บาท ขอบคุณครับ'+(award?'\n🥚 คะแนนบิลนี้ '+award.delta+' คะแนน':'')),buildLineMenuMessage_(r.userId)]);
  if(secFind_('Bills',r.billId).status==='paid')secPushOnce_('complete_'+r.billId,'group',getConfig_().lineGroupId,[lineText_('🎉 '+bill.title+' ชำระครบทั้งบิลแล้ว ขอบคุณทุกคนครับ'),buildLineMenuMessage_('')]);
  return {success:true,status:'approved'};
}
function secWithdraw_(session,b){
  const amount=secMoney_(b.amount),date=secDate_(b.date),purpose=String(b.purpose||'').trim();if(!purpose)throw Error('ระบุวัตถุประสงค์');
  const balance=buildFinanceSummary_(secRows_('Transactions'),secRows_('Withdrawals')).balance;
  if(amount>balance)throw Error('ยอดคงเหลือไม่เพียงพอ');
  const img=secImage_(b),file=DriveApp.getFolderById(getConfig_().driveFolderId).createFile(Utilities.newBlob(img.bytes,img.mime,'withdraw_'+b.requestId+'.jpg'));
  const id='wd_'+Utilities.getUuid();
  secAppend_('Withdrawals',WITHDRAWAL_HEADERS.concat(['clientRequestId']),{id:id,amount:amount,date:date,purpose:purpose,withdrawnBy:session.memberName||session.displayName,proofUrl:file.getUrl(),createdAt:new Date().toISOString(),clientRequestId:b.requestId});
  secPushOnce_('withdraw_'+id,'group',getConfig_().lineGroupId,[lineText_('🧺 ถอนเงิน '+amount.toLocaleString('th-TH')+' บาท\n'+purpose+'\nวันที่ '+b.date),buildLineMenuMessage_('')]);
  return {success:true,id:id};
}
function secPushOnce_(key,channel,target,messages){
  const id=secHash_(key+':'+channel+':'+target),old=secFind_('NotificationLog',id);
  if(old&&old.status==='accepted')return {accepted:0,failed:0,skipped:1};
  if(old&&old.firstAttemptAt&&Date.now()-new Date(old.firstAttemptAt).getTime()>23*3600000){return {accepted:0,failed:1,skipped:0};}
  const currentPayload=JSON.stringify({to:target,messages:lineNotificationMessages_(messages,channel==='personal'?target:'')});
  const changed=old&&old.payload&&old.payload!==currentPayload;
  let retry=!changed&&old&&old.retryKey;
  if(!retry)retry=Utilities.getUuid();
  const base={id:id,billId:key,day:getBangkokDateKey_(new Date()),channel:channel,target:target||'',status:'sending',attempts:Number(old&&old.attempts||0)+1,retryKey:retry,payload:currentPayload,firstAttemptAt:old&&old.firstAttemptAt||new Date().toISOString(),updatedAt:new Date().toISOString()};
  if(old)secUpdate_('NotificationLog',id,base);else secAppend_('NotificationLog',SEC_LOG,base);
  let code=0,message='',accepted=false;
  try{
    if(!target)throw Error('ยังไม่ได้ตั้งผู้รับ');
    const r=UrlFetchApp.fetch(LINE_MESSAGING_PUSH_URL,{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+getConfig_().lineChannelAccessToken,'X-Line-Retry-Key':retry},payload:base.payload,muteHttpExceptions:true});
    code=r.getResponseCode();const headers=r.getAllHeaders();
    accepted=(code>=200&&code<300)||(code===409&&Object.keys(headers).some(k=>k.toLowerCase()==='x-line-accepted-request-id'));
    message=accepted?'LINE รับคำขอแล้ว (ไม่ใช่หลักฐานว่าอ่านหรือส่งถึงเครื่อง)':String(r.getContentText()).slice(0,1000);
  }catch(e){message=e.message;}
  secUpdate_('NotificationLog',id,{status:accepted?'accepted':'failed',httpCode:code,message:message,updatedAt:new Date().toISOString()});
  return {accepted:accepted?1:0,failed:accepted?0:1,skipped:0};
}
function secNotifyBill_(id){
  const bill=secFind_('Bills',id);if(!bill||bill.status!=='open')return {success:true,accepted:0,failed:0,skipped:1};
  const rows=secRows_('BillMembers').filter(r=>String(r.billId)===String(id)&&r.status!=='paid'&&secRemaining_(r)>0);
  if(!rows.length)return {success:true,accepted:0,failed:0,skipped:1};
  const today=getBangkokDateKey_(new Date()),due=String(formatDateValue_(bill.dueDate)).slice(0,10);
  const mood=today>due?'😤 ไก่จิกแก้มป่องแล้วน้า':today===due?'⏰ วันนี้ครบกำหนดแล้วครับ':'🥺 ไก่จิกรออยู่นะ';
  const result={success:true,accepted:0,failed:0,skipped:0};
  function add(r){result.accepted+=r.accepted;result.failed+=r.failed;result.skipped+=r.skipped;}
  // Each chunk + menu is a separate stable ledger entry, within LINE's limits.
  const chunks=[];let text=mood+'\n🧾 '+String(bill.title).slice(0,150)+'\nครบกำหนด '+due+'\n';
  rows.forEach(r=>{const line='\n• '+String(r.memberName).slice(0,100)+' — '+secRemaining_(r).toLocaleString('th-TH')+' บาท';if(text.length+line.length>3500){chunks.push(text);text=mood+'\n'+String(bill.title).slice(0,150)+' (ต่อ)\n';}text+=line;});chunks.push(text);
  chunks.forEach((t,i)=>add(secPushOnce_(id+':'+today+':'+i,'group',getConfig_().lineGroupId,[lineText_(t),buildLineMenuMessage_('')])));
  const currentMembers=secRows_('Members');
  rows.forEach(r=>{
    const current=currentMembers.find(m=>String(m.id)===String(r.memberId));if(current)r.lineUserId=current.lineUserId||r.lineUserId;
    if(!r.lineUserId){add(secPushOnce_(id+':'+today+':'+r.id,'personal','',[]));return;}
    const card=buildMemberBillReminderMessage_(bill,r,true);const petImage=gameLineImage_(r.lineUserId,today>due?'angry':'waiting');if(petImage)card.contents.hero=petImage;card.contents.header.contents[0].text=mood;
    add(secPushOnce_(id+':'+today,'personal',r.lineUserId,[card,buildLineMenuMessage_(r.lineUserId)]));
  });
  result.success=result.failed===0;return result;
}

// Game state is separate from real money. Each hatch stores debit and prize in ONE row.
const GAME_LEDGER=['id','memberId','kind','delta','billId','season','speciesId','name','asset','rarity','at','bankPaidAt','requestId'];
const GAME_PROFILE=['id','speciesId','nickname','updatedAt'];
const GAME_SEASON=['id','name','regularName','secretName','asset','cost','secretChance','enabled'];
const GAME_THEMES=['ข้าวหอม','ฟักทอง','สายหมอก','คริสต์มาส','อรุณรุ่ง','หัวใจ','ดอกไม้','สงกรานต์','ใบชา','สายรุ้ง','นักบิน','ดอกมะลิ','นักสืบ','แม่มด','นักดนตรี','ดาวเหนือ','นักอวกาศ','เจ้าหญิง','ซากุระ','กัปตัน','นักสวน','เมฆน้อย','นักสำรวจ','แสงจันทร์'];
function setupChickenGame(){
  setupSec1V2();return withScriptLock_(function(){
    [['GameLedger',GAME_LEDGER],['GameProfiles',GAME_PROFILE],['GameSeasons',GAME_SEASON]].forEach(x=>ensureHeaders_(getSheet_(x[0]),x[1]));
    const p=PropertiesService.getScriptProperties();
    if(!p.getProperty('CHICKEN_GAME_STARTED_AT'))p.setProperty('CHICKEN_GAME_STARTED_AT',new Date().toISOString());
    if(!p.getProperty('CHICKEN_RANDOM_SECRET'))p.setProperty('CHICKEN_RANDOM_SECRET',Utilities.getUuid()+Utilities.getUuid());
    GAME_THEMES.forEach(function(n,i){const id=new Date(Date.UTC(2026,8+i,1)).toISOString().slice(0,7);if(!secFind_('GameSeasons',id))secAppend_('GameSeasons',GAME_SEASON,{id:id,name:'ฤดูกาล'+n,regularName:'น้อง'+n,secretName:'ราชัน'+n,asset:'c'+String(i+1).padStart(2,'0'),cost:50,secretChance:10,enabled:'true'});});
    p.setProperty('CHICKEN_GAME_ENABLED','true');return {success:true,message:'เพิ่มเกมแล้ว ข้อมูลการเงินเดิมคงอยู่',seasons:24};
  });
}
function gameReady_(){if(PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_ENABLED')!=='true')throw Error('ยังไม่เปิดระบบเกม ให้ Admin รัน setupChickenGame ก่อน');}
function gameMember_(s){if(!s.memberId)throw Error('ต้องผูกสมาชิกในกลุ่มก่อนใช้เกม');return String(s.memberId);}
function gameMonth_(){return getBangkokDateKey_(new Date()).slice(0,7);}
function gameBankTime_(v){
  const raw=String(v||'');if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(raw))throw Error('ระบุวันเวลาโอนจริงตามธนาคาร (เวลาไทย)');
  secDate_(raw.slice(0,10));if(+raw.slice(11,13)>23||+raw.slice(14,16)>59)throw Error('เวลาไม่ถูกต้อง');
  const d=new Date(raw+':00+07:00');if(!Number.isFinite(d.getTime())||d.getTime()>Date.now())throw Error('เวลาโอนต้องไม่เป็นอนาคต');return d.toISOString();
}
function gamePoints_(at,due){
  const p=getBangkokDateKey_(new Date(at)),d=String(formatDateValue_(due)).slice(0,10);secDate_(d);
  const days=Math.round((Date.parse(d+'T00:00:00+07:00')-Date.parse(p+'T00:00:00+07:00'))/86400000);
  return days>=3?100:days>=1?80:days===0?60:0;
}
function gameAward_(memberId,billId){
  gameReady_();const id='award_'+secHash_(memberId+':'+billId),old=secFind_('GameLedger',id);if(old)return old;
  const a=secRows_('BillMembers').find(r=>String(r.memberId)===String(memberId)&&String(r.billId)===String(billId));if(!a||a.status!=='paid')return null;
  const b=secFind_('Bills',billId);if(!b)return null;
  const proofs=secRows_('PaymentReviews').filter(r=>String(r.memberId)===String(memberId)&&String(r.billId)===String(billId)&&r.status==='approved');
  const start=PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_STARTED_AT');
  if(!proofs.length||proofs.some(r=>!r.bankPaidAt||String(r.createdAt)<start))return null;
  const tx=secRows_('Transactions'),committed=proofs.filter(r=>tx.some(t=>t.id===r.transactionId&&String(t.billId)===String(billId)));
  if(committed.reduce((s,r)=>s+Math.round(Number(r.amount)*100),0)<Math.round(Number(a.amount)*100))return null;
  const at=committed.map(r=>String(r.bankPaidAt)).sort().pop(),entry={id:id,memberId:memberId,kind:'award',delta:gamePoints_(at,b.dueDate),billId:billId,name:b.title,at:new Date().toISOString(),bankPaidAt:at};
  secAppend_('GameLedger',GAME_LEDGER,entry);return entry;
}
function gameAwardSafe_(m,b){if(PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_ENABLED')!=='true')return null;try{return gameAward_(m,b);}catch(e){Logger.log('CHICKEN_AWARD_RETRY '+b+': '+e.message);return null;}}
function gameRepair_(){
  gameReady_();const started=Date.now(),report={success:true,checked:0,awarded:0,pending:0,errors:[]},known=new Set(secRows_('GameLedger').filter(r=>r.kind==='award').map(r=>r.id));
  const start=PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_STARTED_AT'),proofs=secRows_('PaymentReviews').filter(r=>r.status==='approved'&&String(r.createdAt)>=start);
  const pending=secRows_('BillMembers').filter(r=>r.status==='paid'&&!known.has('award_'+secHash_(r.memberId+':'+r.billId))&&proofs.some(p=>p.memberId===r.memberId&&p.billId===r.billId));
  pending.slice(0,30).forEach(r=>{if(Date.now()-started>30000)return;report.checked++;try{if(gameAward_(r.memberId,r.billId))report.awarded++;else report.pending++;}catch(e){report.errors.push(e.message)}});report.remaining=pending.length-report.checked;return report;
}
function repairChickenPoints(){return withScriptLock_(gameRepair_);}
function gameEntries_(m){return secRows_('GameLedger').filter(r=>String(r.memberId)===String(m));}
function gameBalance_(rows){return rows.reduce((s,r)=>s+Number(r.delta||0),0);}
function gameCollection_(rows){const map={};rows.filter(r=>r.kind==='hatch').forEach(r=>{if(!map[r.speciesId])map[r.speciesId]={id:r.speciesId,name:r.name,asset:r.asset,rarity:r.rarity,season:r.season,count:0};map[r.speciesId].count++});return Object.keys(map).map(k=>map[k]).reverse();}
function gameSeason_(){const r=secFind_('GameSeasons',gameMonth_());return r&&String(r.enabled)==='true'?r:null;}
function gameRead_(s,b){
  gameReady_();if(b.view==='game-admin'){secAdmin_(s);const start=PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_STARTED_AT');return {month:gameMonth_(),seasons:secRows_('GameSeasons').sort((a,b)=>String(a.id).localeCompare(String(b.id))),assets:GAME_THEMES.map((n,i)=>({id:'c'+String(i+1).padStart(2,'0'),name:n})),missingTimes:secRows_('PaymentReviews').filter(r=>r.status==='approved'&&!r.bankPaidAt&&String(r.createdAt)>=start).slice(0,30).map(r=>({id:r.id,memberName:r.memberName,billId:r.billId,amount:r.amount}))};}
  const m=gameMember_(s),rows=gameEntries_(m);return {balance:gameBalance_(rows),earned:rows.filter(r=>r.kind==='award').reduce((a,r)=>a+Number(r.delta),0),hatchCount:rows.filter(r=>r.kind==='hatch').length,collection:gameCollection_(rows),profile:secFind_('GameProfiles',m)||{speciesId:'',nickname:'จิกจิก'},season:gameSeason_(),month:gameMonth_(),history:paginateLiff_(rows.slice().reverse(),b.page||1)};
}
function gameRoll_(m,id){const key=PropertiesService.getScriptProperties().getProperty('CHICKEN_RANDOM_SECRET');if(!key)throw Error('ยังไม่ได้ตั้งค่าการสุ่ม');const a=Utilities.computeHmacSha256Signature(m+':'+id,key,Utilities.Charset.UTF_8);return ((a[0]&255)*16777216+(a[1]&255)*65536+(a[2]&255)*256+(a[3]&255))/4294967296*100;}
function gameHatch_(s,b){
  gameReady_();const m=gameMember_(s),request=String(b.requestId||'');if(!/^[a-zA-Z0-9_-]{8,150}$/.test(request))throw Error('รหัสคำขอไม่ถูกต้อง');
  const id='hatch_'+secHash_(m+':'+request),old=secFind_('GameLedger',id);if(old)return {success:true,hatch:old,balance:gameBalance_(gameEntries_(m)),replayed:true};
  const season=gameSeason_();if(!season)throw Error('ยังไม่มีฤดูกาลเดือนนี้');if(String(b.season)!==season.id)throw Error('เปลี่ยนเดือนแล้ว กรุณาเปิดหน้าฟักไข่ใหม่');
  const cost=Number(season.cost),chance=Number(season.secretChance);if(!Number.isInteger(cost)||cost<1||cost>10000||!Number.isFinite(chance)||chance<0||chance>100)throw Error('การตั้งค่าฤดูกาลไม่ถูกต้อง');
  const balance=gameBalance_(gameEntries_(m));if(balance<cost)throw Error('คะแนนไม่พอสำหรับฟักไข่');
  const secret=gameRoll_(m,request)<chance,entry={id:id,memberId:m,kind:'hatch',delta:-cost,season:season.id,speciesId:season.id+(secret?'_secret':'_regular'),name:secret?season.secretName:season.regularName,asset:season.asset,rarity:secret?'secret':'regular',requestId:request,at:new Date().toISOString()};
  secAppend_('GameLedger',GAME_LEDGER,entry);return {success:true,hatch:entry,balance:balance-cost,replayed:false};
}
function gameProfile_(s,b){
  gameReady_();const m=gameMember_(s),id=String(b.speciesId||''),name=String(b.nickname||'จิกจิก').trim();
  if(!name||name.length>24||/^[=+@-]/.test(name))throw Error('ชื่อไก่ต้องยาว 1–24 ตัวอักษร และไม่ขึ้นต้นด้วยเครื่องหมายสูตร');
  if(id&&!gameCollection_(gameEntries_(m)).some(r=>r.id===id))throw Error('ยังไม่มีไก่ตัวนี้ในคอลเลกชัน');
  const value={id:m,speciesId:id,nickname:name,updatedAt:new Date().toISOString()};if(secFind_('GameProfiles',m))secUpdate_('GameProfiles',m,value);else secAppend_('GameProfiles',GAME_PROFILE,value);return {success:true,profile:value};
}
function gameSaveSeason_(s,b){
  secAdmin_(s);gameReady_();const id=String(b.id||'');if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(id)||id<gameMonth_())throw Error('เดือนไม่ถูกต้องหรือเป็นเดือนย้อนหลัง');
  if(secRows_('GameLedger').some(r=>r.kind==='hatch'&&r.season===id))throw Error('มีผู้ฟักแล้ว จึงแก้กติกาเดือนนี้ไม่ได้');
  const v={id:id,asset:String(b.asset||''),cost:Number(b.cost),secretChance:Number(b.secretChance),enabled:b.enabled===true?'true':'false'};
  if(!/^c(0[1-9]|1\d|2[0-4])$/.test(v.asset)||!Number.isInteger(v.cost)||v.cost<1||v.cost>10000||!Number.isFinite(v.secretChance)||v.secretChance<0||v.secretChance>100)throw Error('ชุดภาพ คะแนน หรือโอกาสซีเคร็ตไม่ถูกต้อง');
  ['name','regularName','secretName'].forEach(k=>{v[k]=String(b[k]||'').trim();if(!v[k]||v[k].length>60||/^[=+@-]/.test(v[k]))throw Error('ชื่อฤดูกาล/ไก่ไม่ถูกต้อง')});
  if(secFind_('GameSeasons',id))secUpdate_('GameSeasons',id,v);else secAppend_('GameSeasons',GAME_SEASON,v);return {success:true};
}
function gameVerifyTime_(s,b){secAdmin_(s);gameReady_();const r=secFind_('PaymentReviews',b.id);if(!r||r.status!=='approved')throw Error('ยังไม่อนุมัติรายการนี้');const at=gameBankTime_(b.bankPaidAt);if(r.bankPaidAt&&String(r.bankPaidAt)!==at)throw Error('เวลาโอนถูกยืนยันแล้ว');secUpdate_('PaymentReviews',r.id,{bankPaidAt:at});return {success:true,award:gameAwardSafe_(r.memberId,r.billId)};}
function gamePet_(userId){
  let pet={asset:'c01',rarity:'regular',name:'จิกจิก'};try{if(!userId||PropertiesService.getScriptProperties().getProperty('CHICKEN_GAME_ENABLED')!=='true')return pet;const m=getMemberByLineUserId_(userId);if(!m)return pet;const p=secFind_('GameProfiles',String(m.id));if(!p)return pet;const own=gameCollection_(gameEntries_(m.id)).find(r=>r.id===p.speciesId);if(own)pet=Object.assign({},own);pet.name=p.nickname||pet.name;}catch(e){Logger.log('CHICKEN_PET_FALLBACK '+e.message)}return pet;
}
function gameLineImage_(userId,mood){const base=String(PropertiesService.getScriptProperties().getProperty('CHICKEN_ASSET_BASE_URL')||'').replace(/\/$/,'');if(!/^https:\/\//.test(base))return null;const pet=gamePet_(userId),state=['happy','waiting','angry'].includes(mood)?mood:'waiting';return {type:'image',url:base+'/'+pet.asset+'-'+pet.rarity+'-'+state+'.png',size:'full',aspectRatio:'1:1',aspectMode:'fit',animated:true,action:{type:'uri',label:'เล้าไก่ของฉัน',uri:buildLiffMenuUrl_('coop')}};}
