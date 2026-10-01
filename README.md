# Chặt & Chạy — Tiều phu trốn kiểm lâm 🪓🌲
*(English: **Chop & Run — Lumberjack on the run**. The game, share cards and link previews are available in Vietnamese and English.)*

Game 3D endless chạy trên trình duyệt (Next.js + three.js). Bạn là tiều phu lậu trong một khu rừng vô tận:
đốn cây lấy điểm, né kiểm lâm, và chơi tới khi bị tóm. Điểm cao có thể chia sẻ bằng link có Open Graph
(ảnh thẻ điểm hiện đẹp trên Facebook, X, Messenger, Zalo…) và ảnh Story cho Instagram.

- Cây được tạo thủ tục bằng [EZ-Tree](https://github.com/dgreenheck/ez-tree) (mã nguồn v2 nằm trong `src/lib/ez-tree`, giấy phép MIT).
- Cách tổ chức game (logic thuần + test bằng Node, minimap, độ phân giải động, hướng dẫn chơi, lưu kỷ lục trên trình duyệt) lấy cảm hứng từ [Tidewater](https://github.com/dgreenheck/tidewater). Tidewater chạy trên WebGPU với engine riêng nên không chép mã trực tiếp.

## Chạy thử

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # test logic game + chữ ký link chia sẻ
npm run build && npm start
```

Thêm `?debug` vào URL để truy cập engine qua `window.__game`. Thêm `?q=low` hoặc `?q=high` để ép mức đồ họa.

## Ngôn ngữ (Tiếng Việt / English)

- Nút **VI | EN** ở menu, màn hình tạm dừng, trang `/trees` và trang chia sẻ. Lựa chọn được lưu trong cookie `lang`.
- Lần đầu vào: ưu tiên `?lang=vi|en` → cookie → ngôn ngữ trình duyệt (`Accept-Language`) → mặc định tiếng Việt.
- Link chia sẻ ghi lại ngôn ngữ lúc tạo, nên thẻ điểm và preview trên Facebook/X hiện đúng ngôn ngữ của người chia sẻ
  (link cũ không có trường này được coi là tiếng Việt). Người xem vẫn có thể đổi giao diện trang bằng nút VI | EN.
- Chuỗi giao diện nằm trong `src/i18n/vi.ts` và `src/i18n/en.ts` (cú pháp: `{bien}`, `**đậm**`, `[[phím]]`).
  `npm test` kiểm tra hai file có cùng khóa. Tên cây lấy từ `name` / `nameEn` trong `catalog.json`.
- Thêm ngôn ngữ mới: tạo `src/i18n/<mã>.ts` theo kiểu `Dict`, thêm vào `LANGS` / `DICTS` trong `src/i18n/index.ts`.

## Cách chơi

| Phím | Tác dụng |
| --- | --- |
| `W A S D` / phím mũi tên | Di chuyển (theo hướng camera) |
| Chuột (nhấp để khóa con trỏ) / kéo chuột | Xoay camera, cuộn để zoom |
| `Shift` | Chạy nhanh (tốn thể lực) |
| Giữ `Space` / `E` / chuột trái | Chặt cây gần nhất |
| `Esc` / `P` | Tạm dừng |

Trên điện thoại có cần điều khiển, nút **CHẶT**, nút **CHẠY**, và kéo màn hình để xoay camera.

- Cây càng to càng nhiều điểm, nhưng cần nhiều nhát rìu và gây ồn xa hơn.
- Mỗi nhát rìu là một tiếng động: kiểm lâm trong tầm nghe sẽ tới kiểm tra.
- Hình quạt dưới chân kiểm lâm là tầm nhìn. Bị nhìn đủ lâu là “!” và bị truy đuổi.
- Núp trong bụi rậm để biến mất (trừ khi đang chặt). Thân cây và bụi chắn tầm nhìn.
- Đốn liên tục trong 9 giây để nhân combo tới ×5.
- Cho cây đổ trúng kiểm lâm để hạ gục họ 7 giây (+150 điểm).
- Sao truy nã tăng khi bạn gây ồn: kiểm lâm đông hơn, nhanh hơn, tuần tra sát hơn.
- Điểm = điểm gỗ (có combo) + 1 điểm cho mỗi giây sống sót.

## Danh sách cây (sinh từ EZ-Tree)

```bash
npm run trees:generate
```

`scripts/generate-tree-catalog.mjs` mọc từng loài từ preset EZ-Tree với nhiều seed, đo chiều cao, tán,
đường kính thân, số tam giác, rồi tính chỉ số game (số nhát rìu, điểm, bán kính tiếng ồn) và ghi ra
`src/game/trees/catalog.json`. Trong game, mỗi biến thể được mọc lại đúng từ preset + seed (3 cấp LOD),
rồi vẽ bằng `InstancedMesh`, nên hàng trăm cây chỉ tốn vài chục draw call.

Xem trực quan tại trang **/trees**: 12 loài cây chặt được (thông, dương, tần bì, sồi; non → cổ thụ) và 3 loại bụi rậm để ẩn nấp.
Muốn thêm loài: sửa mảng `SPECIES` trong script rồi chạy lại.

## Chia sẻ điểm cao

1. Hết ván → nhập tên → bấm Facebook / X / Instagram / Sao chép link.
2. `POST /api/share` kiểm tra điểm có hợp lý không, ký HMAC và trả về link `/s/<token>`.
3. `/s/<token>` render server-side các thẻ `og:*` và `twitter:*` (`summary_large_image`).
4. `/api/og?t=<token>` sinh ảnh thẻ điểm 1200×630; `&format=story` sinh ảnh 1080×1920 cho Instagram Story.

Instagram không có URL chia sẻ cho web. Trên điện thoại, nút Instagram gửi ảnh Story qua bảng chia sẻ hệ thống
(chọn Instagram → Story). Trên máy tính, nút này tải ảnh về và sao chép link để dán vào sticker Link.

### Biến môi trường (khi deploy)

| Biến | Ý nghĩa |
| --- | --- |
| `SHARE_SECRET` | **Bắt buộc ở production.** Khóa bí mật để ký link chia sẻ (chuỗi ngẫu nhiên dài). |
| `NEXT_PUBLIC_SITE_URL` | URL công khai, ví dụ `https://chat-va-chay.vercel.app`. Nếu bỏ trống thì lấy từ header request. |
| `NEXT_PUBLIC_FB_APP_ID` | Không bắt buộc. Thêm `fb:app_id` để Facebook Debugger hết cảnh báo. |

Facebook và X chỉ đọc được thẻ OG từ một URL công khai (không phải `localhost`). Sau khi deploy (ví dụ Vercel),
kiểm tra bằng [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/).

## Cấu trúc

```
scripts/generate-tree-catalog.mjs   sinh danh sách cây từ EZ-Tree
src/lib/ez-tree/                    thư viện EZ-Tree v2 (MIT, nguyên bản)
src/game/logic/                     logic thuần, có test: rng, sinh rừng theo chunk, điểm/combo/truy nã, payload chia sẻ
src/game/trees/                     catalog.json + kiểu dữ liệu
src/game/engine/                    three.js: cây instanced + LOD + cây trong suốt khi che camera, thế giới vô tận,
                                    tiều phu, AI kiểm lâm, âm thanh tổng hợp WebAudio, hiệu ứng, minimap
src/game/ui/                        React HUD, menu, game over, chia sẻ, điều khiển cảm ứng, trang danh sách cây
src/pages/                          /, /trees, /s/[token], /api/share, /api/og
src/server/shareToken.ts            ký và xác thực link chia sẻ
src/i18n/                           từ điển vi/en, nhận diện ngôn ngữ, nút VI | EN
tests/                              node --test
```

## Bản quyền tài nguyên

- EZ-Tree © Daniel Greenheck, MIT (`src/lib/ez-tree/LICENSE`). Kết cấu vỏ cây từ ambientCG (CC0), xem `public/textures/LICENSE.md`.
  Lá, cỏ, đá lấy từ repo EZ-Tree.
- Font Be Vietnam Pro, SIL Open Font License (`public/fonts/OFL.txt`).
- Âm thanh được tổng hợp bằng WebAudio, không dùng file.
