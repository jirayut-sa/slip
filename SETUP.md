# SEC1 ไก่จิกทวงตัง — คู่มือติดตั้งและอัปเกรด v3

ชุดนี้ต่อจากฐาน SEC1 เดิม เพิ่มเกมสะสมไก่โดยแยกบัญชีคะแนนออกจากบัญชีเงิน ไม่มีการล้างข้อมูลเดิม และไม่เปิดคำสั่งข้อความอื่นกลับมา

## 1. ไฟล์ต้องวางที่ไหน

| ไฟล์ | ปลายทาง |
| --- | --- |
| Code.gs | Google Apps Script แทน Code.gs เดิมทั้งไฟล์ |
| appsscript.json | Apps Script → Project Settings → Show appsscript.json manifest file |
| index.html, liff.html | รากเว็บไซต์ GitHub Pages เดิม |
| app.js, styles.css, config.js | โฟลเดอร์เดียวกับ HTML ทั้งสอง |
| assets/ ทั้งโฟลเดอร์ | รากเว็บไซต์เดียวกัน ห้ามเปลี่ยนชื่อไฟล์ |
| tests/, package.json, build-assets.cjs, finish-assets.py | สำหรับนักพัฒนา ไม่ต้องอัปโหลดไป Apps Script |

**ต้องใช้ไฟล์จากชุดเดียวกันทั้งหมด** HTML รุ่นนี้เรียก app.js, styles.css และ config.js จึงคัดลอกเฉพาะ HTML ไปแทนไม่ได้ ไม่ใช้ Tailwind CDN และฟอนต์ไทยอยู่ใน assets/fonts แล้ว

## 2. ก่อนอัปเกรด

1. ทำสำเนา Google Sheets และ Code.gs เดิมไว้ พร้อมจด deployment URL ปัจจุบัน
2. รอให้ Admin ตรวจรายการที่กำลังลงบัญชีอยู่เสร็จก่อน ไม่แก้ข้อมูลใน Sheets ระหว่างรายการทำงาน
3. คง Script Properties เดิม และคง LINE Login channel / LIFF app เดิมไว้
4. เปลี่ยน Code.gs และตรวจ manifest ถ้ามี dependencies หรือ scopes ของงานอื่นอยู่ ให้รวมไว้ด้วย ไม่ลบการตั้งค่างานอื่น

## 3. Script Properties

ตั้งใน Apps Script → Project Settings → Script Properties

| ชื่อ | ค่า / หมายเหตุ |
| --- | --- |
| SHEET_ID | ID Google Sheets เดิม ไม่ใช่ URL ทั้งเส้น |
| DRIVE_FOLDER_ID | ID โฟลเดอร์เก็บสลิปเดิม |
| LINE_CHANNEL_ACCESS_TOKEN | Channel access token ของ Messaging API เก็บเฉพาะ Backend |
| LINE_LOGIN_CHANNEL_ID | เลข Channel ID ของ LINE Login ที่สร้าง LIFF ต้องตรงกับ token ผู้ใช้ |
| LIFF_ID | `2011470307-gvcrsOhk` |
| LINE_GROUP_ID | Group ID กลุ่มใหญ่ที่ใช้งาน |
| LINE_ADMIN_USER_IDS | `Uคนแรก,Uคนที่สอง` คั่นด้วย comma ไม่มีวงเล็บหรือเครื่องหมายคำพูด |
| BANK_NAME | ชื่อธนาคารปลายทาง ตรวจให้ตรงกับบัญชีจริง |
| BANK_ACCOUNT_NO | เลขบัญชีจริง |
| BANK_ACCOUNT_NAME | ชื่อบัญชีจริง |
| PUBLIC_WEB_APP_URL | `https://jirayut-sa.github.io/slip/liff.html` |
| LINE_WEBHOOK_KEY | คงค่าที่ใช้งานเดิม ตั้งใหม่แล้วต้องแก้ Webhook URL ให้ตรง |
| CHICKEN_ASSET_BASE_URL | **เพิ่มใหม่:** `https://jirayut-sa.github.io/slip/assets` ไม่มี / ท้าย URL |
| GEMINI_API_KEY | ไม่บังคับ ใช้ OCR อ่านข้อมูล หากไม่ตั้ง สมาชิกกรอกข้อมูลจากสลิปได้ |
| GEMINI_MODELS | ทางเลือก: รายชื่อโมเดลที่บัญชีคุณมีสิทธิ์ใช้ คั่น comma; คงค่าเดิมได้ |

ไม่ใส่ LINE channel token, Gemini key, webhook key หรือ CHICKEN_RANDOM_SECRET ใน HTML/config.js

### ค่าที่ระบบสร้างเอง

รัน `setupChickenGame()` ครั้งแรก ระบบเพิ่ม:

- `CHICKEN_GAME_ENABLED=true`
- `CHICKEN_GAME_STARTED_AT` เวลาเริ่มใช้เกม เพื่อไม่แจกคะแนนย้อนหลังให้ประวัติเดิม
- `CHICKEN_RANDOM_SECRET` กุญแจสุ่มผลฝั่ง Server **ห้ามลบหรือเปลี่ยนระหว่างใช้งาน**
- ชีต `GameLedger`, `GameProfiles`, `GameSeasons`
- คอลัมน์ `bankPaidAt` ใน PaymentReviews และ `memberId` ใน Transactions ถ้ายังไม่มี

ฟังก์ชันนี้รันซ้ำได้ ไม่ล้างชีต ไม่รีเซ็ตเวลาเริ่มเกม ไม่สร้างฤดูกาลเดิมซ้ำ

## 4. ติดตั้ง Backend

1. วาง Code.gs รุ่นนี้ แล้วบันทึก
2. ตรวจ Project Settings → Time zone เป็น Asia/Bangkok และใช้ V8
3. เลือกฟังก์ชัน `diagnoseSec1Setup` แล้ว Run เพื่อตรวจสิทธิ์ Sheets/Drive
4. เลือก `setupChickenGame` แล้ว Run ด้วยบัญชีเจ้าของ Script/Sheets และอนุญาตสิทธิ์ที่ Google ขอ
5. ถ้ายังไม่เคยตั้ง Trigger หรือ Trigger หาย ให้รัน `setupMonthlyLineTrigger` หนึ่งครั้ง ฟังก์ชันจัด Trigger ของระบบเอง หากของเดิมอยู่ครบ ไม่จำเป็นต้องรันใหม่
6. Deploy → Manage deployments → Edit → Version: New version → Deploy โดย Execute as Me และ Who has access: Anyone
7. ใช้ URL `/exec` ของ deployment ไม่ใช้ `/dev`
8. เปิด URL `/exec` ในเบราว์เซอร์ ต้องเห็น JSON `version: "3.0-chicken"` และ `menuPolicy: "strict-menu-only-v2"`

ไม่ต้องรัน `doPost` จากปุ่ม Run และไม่ต้อง Deploy ใหม่เพียงเพราะแก้ข้อมูลฤดูกาลผ่านหน้า Admin

## 5. ตั้งเว็บและ LIFF

1. ตรวจ `config.js`: `apiUrl` ต้องตรงกับ `/exec` ที่ Deploy แล้ว; ในชุดนี้คง URL เดิมที่คุณให้ไว้ ส่วน `liffId` ใส่ให้แล้ว
2. อัปโหลด index.html, liff.html, app.js, styles.css, config.js และ assets/ ทั้งหมดไป GitHub Pages
3. LINE Developers → LINE Login channel → LIFF → Endpoint URL เป็น `https://jirayut-sa.github.io/slip/liff.html` และเปิด scope `profile`
4. เปิด `https://jirayut-sa.github.io/slip/assets/c01-regular-happy.png` ต้องโหลดภาพได้ผ่าน HTTPS
5. ปิดหน้า LIFF เดิมแล้วเปิดใหม่ หลังเปลี่ยนไฟล์บน GitHub Pages รอให้ Pages deploy เสร็จก่อนทดสอบ

index.html เปิดจากเบราว์เซอร์ได้โดยไม่บังคับ Login จนกดเข้าสู่ระบบ ส่วน liff.html ต้องตรวจ LINE ก่อนอ่านข้อมูลเฉพาะสมาชิก ไม่มีการเปิดข้อมูลการเงินสาธารณะ

### ลิงก์เมนู

Rich Menu ที่สร้างใน LINE OA Manager ให้ Action เป็น **Link** ทุกช่อง ไม่ใช่ Text เมนู Flex ที่บอตส่งจะใช้ URI อยู่แล้ว

| เมนู | URL |
| --- | --- |
| บิลของฉัน | https://liff.line.me/2011470307-gvcrsOhk?view=my-bills |
| บิลที่กำลังเรียกเก็บ | https://liff.line.me/2011470307-gvcrsOhk?view=open-bills |
| สรุปยอด | https://liff.line.me/2011470307-gvcrsOhk?view=summary |
| รายจ่าย | https://liff.line.me/2011470307-gvcrsOhk?view=expenses |
| ประวัติ | https://liff.line.me/2011470307-gvcrsOhk?view=history |
| เล้าไก่ | https://liff.line.me/2011470307-gvcrsOhk?view=coop |
| ฟักไข่ | https://liff.line.me/2011470307-gvcrsOhk?view=hatch |
| คะแนน | https://liff.line.me/2011470307-gvcrsOhk?view=points |
| สร้างบิล (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=create-bill |
| แผนรายเดือน (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=plans |
| ถอนเงิน (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=create-withdrawal |
| ตรวจสลิป (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=reviews |
| สถานะแจ้งเตือน (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=notifications |
| จัดการเกม (Admin) | https://liff.line.me/2011470307-gvcrsOhk?view=game-admin |

ปุ่มชำระเงินในบิลใส่ billId ให้อัตโนมัติ สมาชิกและชนิดบิลอ้างอิงจากบัญชี LINE และข้อมูลบิลจริง

## 6. Webhook และสมาชิก

Webhook URL คือ `/exec?key=<ค่า LINE_WEBHOOK_KEY>` เปิด Use webhook ใน Messaging API แล้ว Verify ตรวจ Executions ของ Apps Script เมื่อพิมพ์ในกลุ่ม

- มีเพียงข้อความ `เมนู` และ `sec1` เท่านั้นที่ส่งเมนูตอบกลับ รับ SEC1 ตัวพิมพ์ใหญ่และตัดช่องว่างหัวท้าย
- `สรุป`, `บิล`, `รายชื่อสมาชิก`, `ลงทะเบียน`, `ถอน`, ข้อความทั่วไป ภาพ และ postback เก่าจะไม่เรียกเมนู
- ใช้งานผ่านปุ่ม LIFF การส่งสลิปในแชตไม่ใช่ช่องทางลงบัญชีในเวอร์ชันนี้
- ถ้าบอตตอบข้อความทั่วไปอยู่ ให้ตรวจว่า Deploy เป็นรุ่นใหม่แล้ว และปิด Auto-response/Keyword response ที่สร้างไว้ใน OA Manager
- สมาชิกที่ยังไม่ผูกบัญชีให้พิมพ์ `เมนู` ในกลุ่มที่ตั้ง LINE_GROUP_ID ไว้ ระบบผูกโปรไฟล์ผู้ส่ง บัญชีที่ LINE ไม่อนุญาตดึงรายชื่อทั้งกลุ่ม (HTTP 403) ใช้วิธีนี้ได้ ไม่ข้ามข้อจำกัด API
- Admin ต้องใช้ LINE user ID ไม่ใช่ display name/เบอร์โทร สมาชิกเพิ่มเพื่อน OA เพื่อรับข้อความส่วนตัวตามเงื่อนไข LINE
- แชร์โฟลเดอร์ Drive ให้ Google account ของ Admin ทั้งสองเพื่อเปิดหลักฐานได้

Webhook นี้คงวิธี query key จากระบบเดิม Apps Script ไม่เปิด request headers ให้ตรวจ X-Line-Signature จึงไม่ใช่การตรวจลายเซ็น LINE หากต้องการยืนยันผู้ส่งด้วย HMAC ให้วาง gateway ตรวจลายเซ็นก่อนส่งต่อมายัง URL ลับนี้

## 7. คะแนนและหลักฐาน

| เวลาโอนจริงเทียบวันครบกำหนด ตามเวลาไทย | คะแนนต่อสมาชิกต่อบิล |
| --- | ---: |
| ก่อนอย่างน้อย 3 วัน | 100 XP |
| ก่อน 1–2 วัน | 80 XP |
| วันครบกำหนด | 60 XP |
| หลังวันครบกำหนด | 0 XP |

1. สมาชิกเปิดบิล ส่งรูปครั้งเดียว ระบบย่อรูปให้สูงสุด 1600 px ด้านยาว แล้ว OCR ช่วยอ่าน
2. สมาชิกตรวจยอด/วันที่ก่อนส่งตรวจ ยอดเงินยังไม่เพิ่มตอนนี้
3. Admin เปิดตรวจสลิป ตรวจรายการเงินเข้าในธนาคารจริง ระบุเลขอ้างอิงและ **วันเวลาโอนจริงตามธนาคาร (เวลาไทย)** แล้วติ๊กยืนยัน
4. ระบบลงบัญชีและคำนวณสถานะชำระก่อน จากนั้นจึงให้คะแนนเมื่อชำระครบ
5. แบ่งจ่ายหลายครั้งจะได้คะแนนเมื่อครบยอด โดยใช้เวลาที่ช้าที่สุดของรายการที่จ่ายครบ และต้องมีเวลาโอนยืนยันทุกหลักฐาน

เวลาอนุมัติของ Admin ไม่ใช่เวลาใช้คำนวณคะแนน วันที่สมาชิกกรอกหรือ OCR อ่านได้ไม่ใช้แจกคะแนนโดยลำพัง คะแนนเริ่มสำหรับหลักฐานใหม่หลังติดตั้งเกม; บิลที่มีหลักฐานเก่าปะปนไม่แจกย้อนหลังอัตโนมัติ

ถ้า client เก่าอนุมัติโดยไม่มี bankPaidAt เงินยังลงบัญชีได้ แต่คะแนนรอข้อมูล Admin ไป **จัดการเกม → รายการที่ยังไม่มีเวลาโอนยืนยัน** เพื่อตรวจแล้วกรอกให้ครบ เวลาที่ตรวจยืนยันแล้วแก้ซ้ำเป็นค่าอื่นผ่าน API ไม่ได้

OCR ไม่รับรองสลิปแท้หรือเงินเข้า และชุดนี้ไม่มี K PLUS/bank verification API ที่เชื่อมจริง ต้องใช้ Admin ยืนยันเงินเข้า

## 8. เกมฟักไข่และฤดูกาล

- ค่าเริ่มต้น 50 XP ต่อไข่ โอกาสปกติ 90% ซีเคร็ต 10% ไม่มีการขายคะแนนหรือแลกคืนเป็นเงิน
- ผลสุ่มตัดสินที่ Server ก่อนเริ่มแอนิเมชัน การจิกไข่ 5 ครั้งเป็นการเปิดผล ไม่เปลี่ยนโอกาสชนะ มีปุ่มเปิดผลทันทีและเปิดเสียงได้ตามต้องการ
- การหักคะแนนและรางวัลอยู่ในแถว GameLedger เดียวกัน มี Script Lock และ request ID ป้องกันกดซ้ำ
- หากเน็ตหลุด อย่าล้างข้อมูลเว็บไซต์ เปิดหน้าฟักไข่แล้วกด **ตรวจผลการฟักครั้งก่อน** ใช้ request ID เดิม ไม่หักซ้ำ ผลที่บันทึกแล้วอยู่ในเล้าแม้ปิดแอนิเมชัน
- ได้ซ้ำเพิ่มจำนวนสะสม สมาชิกตั้งชื่อไก่และเลือกเพื่อนจิกได้เฉพาะตัวที่ตนมี
- เพื่อนที่เลือกใช้กับภาพแจ้งเตือนส่วนตัว กลุ่มใช้ไก่กลาง ดีใจเมื่อยืนยันชำระ และแก้มป่องเมื่อเลยกำหนด
- ระบบเตรียม 24 ฤดูกาล กันยายน 2026–สิงหาคม 2028 เดือนละ 1 แบบปกติและ 1 ซีเคร็ต เปลี่ยนเดือนตาม Asia/Bangkok ของ Server คอลเลกชันเก่าไม่หาย
- Admin แก้/เพิ่มเดือนอนาคตได้ที่จัดการเกม เลือกชุดภาพ ค่า XP และโอกาสซีเคร็ต เดือนที่มีผู้ฟักแล้วแก้กติกาไม่ได้
- หลังสิงหาคม 2028 ให้สร้างฤดูกาลต่อในหน้า Admin โดยเลือกจากชุดภาพเดิมได้ ถ้าต้องการงานภาพใหม่เกิน 24 แบบ ต้องเพิ่ม assets และแก้ catalog/validation ใน Code.gs และ app.js ด้วย ชุดนี้ไม่ได้เรียก AI สร้างภาพใหม่ทุกเดือนเอง
- รูป LINE ใช้ APNG 256×256 จำนวน 144 ไฟล์ ขนาดไม่เกิน 300 KB ต่อไฟล์ การเล่นภาพขึ้นกับการตั้งค่า LINE ของผู้รับ ถ้าไม่เล่นภาพเคลื่อนไหว ยังเห็นเฟรมแรก

## 9. แจ้งเตือนและความเร็ว

รายเดือนตรวจช่วงวันที่ 23–28 กิจกรรมตรวจทุกวันเฉพาะผู้ค้าง รอบหลักประมาณ 12:00 และสำรองประมาณ 12:30 เวลาไทย มีบันทึกแยกต่อบิล/วัน/ช่องทาง เมื่อ LINE รับคำขอสำเร็จแล้วรอบสำรองจะข้าม เป้าหมายที่ล้มเหลวจึงลองใหม่

**Apps Script ไม่รับประกันตรงนาที 12:00** nearMinute อาจคลาดเคลื่อน ±15 นาที หากต้องการตรงนาทีต้องใช้ scheduler ภายนอก (ยังไม่ได้เพิ่มในชุดนี้)

ทุกการแจ้งเตือนแนบเมนูหนึ่งชุดเสมอ กลุ่มแสดงชื่อบิล ชื่อผู้ค้างและยอด ส่วนตัวส่งเฉพาะผู้ค้างที่มี LINE ID; LINE accepted หมายถึงรับคำขอ ไม่ใช่ยืนยันว่าเครื่องผู้รับได้อ่านแล้ว

ตรวจสถานะผ่านเมนู Admin → สถานะส่งเตือน หรือรัน `diagnoseDailyReminder()` แบบไม่ส่งจริง `testDailyReminderNow()` และ `testLineMenuToGroup()` **ส่งจริง** ให้ใช้เมื่อพร้อมทดสอบเท่านั้น

ผลตรวจ LINE token cache สูงสุด 900 วินาที ใช้ SHA256 key ไม่เก็บ raw token ใน CacheService การอนุมัติและถอนเงินตรวจ token ใหม่ คะแนน บิล ยอดเงินและประวัติอ่าน Sheets ใหม่ทุกครั้ง ไม่มี financial cache หน้าเว็บโหลดข้อมูลตามเมนู มี skeleton และแบ่งประวัติ 10 รายการ รูปอัปโหลดครั้งเดียวหลังย่อ และแบบอักษร/ภาพเว็บใช้ไฟล์ท้องถิ่นของเว็บไซต์

ถ้าเกมแจกคะแนนสะดุดหลังเงินลงบัญชีแล้ว เงินไม่ย้อนกลับ ระบบซ่อมคะแนนในรอบประจำวันได้ หรือ Admin กดตรวจและซ่อมคะแนน / รัน `repairChickenPoints()` เมื่อมีเวลาธนาคารครบ โดยไม่ให้คะแนนซ้ำ

## 10. ตรวจหลังติดตั้งจริง

- เปิด /exec เห็น version 3.0-chicken และ LIFF ทุกเมนูเข้าได้ด้วย Admin ทั้งสอง/สมาชิก
- พิมพ์คำทั่วไปแล้วเงียบ; พิมพ์ เมนู และ sec1 แล้วเมนูมา
- สร้างบิลทดสอบกับสมาชิกที่ยินยอม ตรวจชื่อ/ยอด/กำหนดชำระให้ถูก
- ทดสอบการชำระและอนุมัติด้วยหลักฐานจริง ตรวจ Transactions/BillMembers/PaymentReviews/GameLedger ว่าตรงกัน ไม่ส่งสลิปทดสอบปลอมลงบัญชีจริง
- ฟักไข่ ตรวจ XP ลด 50 ต่อคำขอและรางวัลเข้าคอลเลกชัน เลือกไก่สำหรับส่วนตัว
- ตรวจแจ้งเตือนกลุ่ม/ส่วนตัวและภาพ APNG บนอุปกรณ์ LINE จริง สมาชิกที่จ่ายครบต้องไม่ถูกทวง
- ตรวจ Trigger และประวัติแจ้งเตือนวันถัดไป หาก failed ให้ดู HTTP code/ข้อความก่อนกดทดสอบซ้ำ

การทดสอบในชุดนี้ใช้บริการจำลอง ไม่สามารถรับรองโควตา สิทธิ์บัญชี LINE/Google การอ่าน OCR จริง หรือการส่งถึงเครื่องของระบบคุณ ดู TEST-REPORT.md สำหรับขอบเขตที่ทดสอบแล้ว

## 11. ทดสอบโค้ดสำหรับนักพัฒนา

ใช้ Node.js 20+:

```sh
npm install
npm test
npx playwright install chromium
npm run test:ui
```

เกม/การเงินใน tests ใช้ Sheets, Drive, LINE จำลองทั้งหมด ไม่ส่งข้อความจริง หากมี Chromium อยู่แล้ว ตั้ง CHROMIUM_PATH เป็นพาธ executable ได้

สร้างภาพซ้ำ (ไม่ต้องทำในการติดตั้งปกติ เพราะมีภาพครบแล้ว):

```sh
python3 -m pip install Pillow
npm run build:assets
```

สคริปต์สร้าง frames ชั่วคราวใน assets/frames เก็บไว้เฉพาะระหว่างสร้าง ไม่ต้องนำ frames ไป GitHub Pages ฟอนต์ Noto Sans Thai ใช้ตามใบอนุญาตใน assets/fonts/LICENSE.txt

## เอกสารอ้างอิงบริการ

- LINE APNG/Flex: https://developers.line.biz/en/reference/messaging-api/#image
- Apps Script ClockTriggerBuilder: https://developers.google.com/apps-script/reference/script/clock-trigger-builder
