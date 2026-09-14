# 灵境·课室 —— 素材后处理（学生立绘 + 水墨山水屏风）
# 输入：ImageGen 生成的 RGB PNG（学生背景是"烘焙"进像素的棋盘格，无 alpha）
# 学生：①"浅灰去饱和"判背景 → ②scipy 连通域取"与四边连通"为外部背景 + "小口袋(面积<2000 且紧贴棋盘格两灰)"
#      ③保守去光晕 → ④裁右下角水印带 → ⑤bbox 裁剪 → ⑥缩放 → 输出 RGBA
# 山水：仅缩放 + 转 JPEG（不透明，作屏风贴图）
# 附带：写出 public/students/aspects.js，供前端自动同步立绘宽高比
# 坑：PIL.ImageDraw.floodfill 对 Image.fromarray(...) 生成的图**静默不写入**，勿用。
from PIL import Image
import numpy as np
import os
from scipy import ndimage

SRC = r"C:/Users/Administrator/WorkBuddy/lingjing/public/students"
# 学生：民国/抗战热血青年风（无眼镜、眼里有光、朝气有信仰）
MAP = {
    "1930s_1940s_Chinese_Republican_2026-09-10T05-57-52.png": "xiaoming",  # 好奇型
    "1930s_1940s_Chinese_Republican_2026-09-10T05-58-22.png": "xiaohong",  # 严谨型（无眼镜）
    "1930s_1940s_Chinese_Republican_2026-09-10T05-58-46.png": "xiaogang",  # 活泼型
    "1930s_1940s_Chinese_Republican_2026-09-10T05-59-13.png": "xiaoli",    # 害羞型
    "1930s_1940s_Chinese_Republican_2026-09-10T05-59-35.png": "xiaohua",   # 自信型
}
# 水墨山水屏风
LANDSCAPE = {
    "Misty_traditional_Chinese_ink__2026-09-10T06-00-00.png": "screen_a",
    "Towering_Chinese_ink_wash_land_2026-09-10T06-00-21.png": "screen_b",
}
TARGET_W = 560


def cut_bg(path):
    im = Image.open(path).convert("RGB")
    rgb = np.asarray(im)
    a = rgb.astype(np.int16)
    mx, mn = a.max(2), a.min(2)
    bglike = ((mx - mn) <= 14) & (mn >= 198)          # 两种棋盘格灰都是"去饱和浅灰"
    lab, n = ndimage.label(bglike)                     # 4-连通
    sizes = np.bincount(lab.ravel(), minlength=n + 1)
    # ① 与图像四边连通的分量 = 外部背景（不限大小）
    border = np.concatenate([lab[0, :], lab[-1, :], lab[:, 0], lab[:, -1]])
    bl = np.unique(border)
    outer = np.isin(lab, bl[bl != 0])
    # ② 小口袋：面积 < 2000 且紧贴棋盘格两种具体灰度（发丝缝隙），不会误伤头发高光/制服白
    d1 = np.abs(a - np.array([251, 251, 249])).sum(2)
    d2 = np.abs(a - np.array([225, 223, 221])).sum(2)
    pocket = bglike & ((d1 <= 18) | (d2 <= 18)) & (sizes[lab] < 2000)
    alpha = np.where(outer | pocket, 0, 255).astype(np.uint8)
    # 保守去光晕：仅抹"很接近纯背景灰"且紧贴透明的像素，1 轮
    t = alpha == 0
    adj = np.zeros_like(t)
    adj[1:, :] |= t[:-1, :]
    adj[:-1, :] |= t[1:, :]
    adj[:, 1:] |= t[:, :-1]
    adj[:, :-1] |= t[:, 1:]
    tight = ((mx - mn) <= 10) & (mn >= 215)
    alpha[(alpha == 255) & tight & adj] = 0
    return Image.fromarray(np.dstack([rgb, alpha]), "RGBA")


def cut_watermark(im):
    """裁掉右下角 ImageGen 的 'AI生成' 水印带（底部 9% + 右侧 3%）"""
    w, h = im.size
    return im.crop((0, 0, int(w * 0.97), int(h * 0.91)))


os.makedirs(os.path.join(SRC, "_originals"), exist_ok=True)
finals, aspects = {}, {}
for src, name in MAP.items():
    p = os.path.join(SRC, src)
    if not os.path.exists(p):
        p = os.path.join(SRC, "_originals", src)
    if not os.path.exists(p):
        print("MISSING", src)
        continue
    out = cut_bg(p)
    out = cut_watermark(out)
    bb = out.getbbox()
    if bb:
        pad = 6
        out = out.crop((max(0, bb[0] - pad), max(0, bb[1] - pad),
                        min(out.width, bb[2] + pad), min(out.height, bb[3] + pad)))
    w, h = out.size
    out = out.resize((TARGET_W, max(1, int(h * TARGET_W / w))), Image.LANCZOS)
    out.save(os.path.join(SRC, name + ".png"), optimize=True)
    finals[name] = out
    aspects[name] = round(out.width / out.height, 4)
    tr = (np.asarray(out)[:, :, 3] < 10).mean()
    print(f"{name:9s} -> {out.size} transparent={tr:.1%} {os.path.getsize(os.path.join(SRC,name+'.png'))} bytes")
    if os.path.dirname(p) == SRC:
        os.replace(p, os.path.join(SRC, "_originals", src))

# 山水屏风：缩放 + JPEG（不透明贴图）
for src, name in LANDSCAPE.items():
    p = os.path.join(SRC, src)
    if not os.path.exists(p):
        p = os.path.join(SRC, "_originals", src)
    if not os.path.exists(p):
        print("MISSING", src)
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    im = im.resize((1024, max(1, int(h * 1024 / w))), Image.LANCZOS)
    dst = os.path.join(SRC, name + ".jpg")
    im.save(dst, quality=86, optimize=True)
    print(f"{name:9s} -> {im.size} {os.path.getsize(dst)} bytes")
    if os.path.dirname(p) == SRC:
        os.replace(p, os.path.join(SRC, "_originals", src))

# 供前端自动同步立绘宽高比
if aspects:
    with open(os.path.join(SRC, "aspects.js"), "w", encoding="utf-8") as f:
        f.write("export const STUDENT_ASPECT = " + str(aspects).replace("'", '"') + ";\n")
    print("aspects.js ->", aspects)

# 拼图（一次过目）：棋盘垫底，暴露没抠干净的残留
if finals:
    from PIL import ImageDraw
    order = [n for n in ["xiaoming", "xiaohong", "xiaogang", "xiaoli", "xiaohua"] if n in finals]
    cell = 300
    sheet = Image.new("RGBA", (cell * len(order), cell + 26), (255, 255, 255, 255))
    dd = ImageDraw.Draw(sheet)
    for yy in range(0, cell, 20):
        for xx in range(0, cell * len(order), 20):
            if ((xx // 20) + (yy // 20)) % 2:
                dd.rectangle([xx, yy, xx + 19, yy + 19], fill=(228, 230, 236, 255))
    for i, name in enumerate(order):
        im = finals[name]
        s = min(cell / im.width, cell / im.height)
        r = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        sheet.alpha_composite(r, (i * cell + (cell - r.width) // 2, (cell - r.height) // 2))
        dd.text((i * cell + 8, cell + 6), name, fill=(200, 30, 30, 255))
    sheet.convert("RGB").save(os.path.join(SRC, "_contact_sheet.png"))
    print("contact sheet ->", os.path.join(SRC, "_contact_sheet.png"))
