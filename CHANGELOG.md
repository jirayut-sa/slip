# v3.0 Chicken Club

- เพิ่ม GameLedger/GameProfiles/GameSeasons แยกจากเงิน พร้อมคะแนนจากเวลาโอนที่ Admin ยืนยัน
- ฟักไข่ 50 XP ค่าเริ่มต้น สุ่มฝั่ง Server 90/10 ผลและการหักเป็นรายการเดียว retry ได้ด้วย request ID
- คอลเลกชันไก่ ตั้งชื่อ เลือกภาพแจ้งเตือน และ 24 ฤดูกาลปกติ/ซีเคร็ต
- เพิ่ม UI coop/hatch/points/game-admin; ยังคง finance views และ strict menu-only policy
- ธีมครีม/น้ำตาล/ส้ม พร้อม SVG, APNG 3 อารมณ์, ฟอนต์ไทยแบบ local และ reduced-motion
- เพิ่ม bankPaidAt ใน PaymentReviews; memberId ใน Transactions และใช้ ID ก่อนชื่อเมื่อรวมยอด/อ่านประวัติใหม่
- ยังคง token cache SHA256 สูงสุด 15 นาที และไม่ cache เงิน
- URL ตามเมนูที่เปิด รองรับรีโหลด/กู้ผลฟัก และเก็บ bill-detail เมื่อรีโหลดรายละเอียดบิล
- แยก app.js/styles.css/config.js ร่วมระหว่าง index/LIFF เพื่อลดโค้ดซ้ำ

อัปเกรดด้วย setupChickenGame() และ Deploy Code.gs ใหม่ตาม SETUP.md
