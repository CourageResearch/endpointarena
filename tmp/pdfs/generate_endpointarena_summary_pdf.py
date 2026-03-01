from pathlib import Path
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas

OUTPUT = Path('output/pdf/endpointarena-app-summary.pdf')
OUTPUT.parent.mkdir(parents=True, exist_ok=True)

FONTS_DIR = Path('tmp/pdfs/fonts')
SERIF_TTF = FONTS_DIR / 'CormorantGaramond-Regular.ttf'
SERIF_TTF_FALLBACK = FONTS_DIR / 'CormorantGaramond-Light.ttf'
SANS_REGULAR_TTF = FONTS_DIR / 'Inter-Regular.ttf'
SANS_MEDIUM_TTF = FONTS_DIR / 'Inter-Medium.ttf'
SANS_SEMIBOLD_TTF = FONTS_DIR / 'Inter-SemiBold.ttf'

SERIF = 'Times-Bold'
SANS = 'Helvetica'
SANS_MEDIUM = 'Helvetica-Bold'
SANS_SEMIBOLD = 'Helvetica-Bold'


def register_fonts() -> None:
    global SERIF, SANS, SANS_MEDIUM, SANS_SEMIBOLD
    try:
        if SERIF_TTF.exists():
            pdfmetrics.registerFont(TTFont('EA-Serif', str(SERIF_TTF)))
            SERIF = 'EA-Serif'
        elif SERIF_TTF_FALLBACK.exists():
            pdfmetrics.registerFont(TTFont('EA-Serif', str(SERIF_TTF_FALLBACK)))
            SERIF = 'EA-Serif'
        if SANS_REGULAR_TTF.exists():
            pdfmetrics.registerFont(TTFont('EA-Sans', str(SANS_REGULAR_TTF)))
            SANS = 'EA-Sans'
        if SANS_MEDIUM_TTF.exists():
            pdfmetrics.registerFont(TTFont('EA-Sans-Medium', str(SANS_MEDIUM_TTF)))
            SANS_MEDIUM = 'EA-Sans-Medium'
        if SANS_SEMIBOLD_TTF.exists():
            pdfmetrics.registerFont(TTFont('EA-Sans-SemiBold', str(SANS_SEMIBOLD_TTF)))
            SANS_SEMIBOLD = 'EA-Sans-SemiBold'
    except Exception:
        # Fallback to built-in PDF fonts if local font registration fails.
        SERIF = 'Times-Bold'
        SANS = 'Helvetica'
        SANS_MEDIUM = 'Helvetica-Bold'
        SANS_SEMIBOLD = 'Helvetica-Bold'


register_fonts()

PAGE_W, PAGE_H = letter

BG = colors.HexColor('#F5F2ED')
PANEL = colors.Color(1, 1, 1, alpha=0.93)
TEXT = colors.HexColor('#1A1A1A')
MUTED = colors.HexColor('#8A8075')
SUBTLE = colors.HexColor('#B5AA9E')
BORDER = colors.HexColor('#E8DDD0')
BRAND = [
    colors.HexColor('#EF6F67'),
    colors.HexColor('#5DBB63'),
    colors.HexColor('#D39D2E'),
    colors.HexColor('#5BA5ED'),
]

PANEL_X = 32
PANEL_Y = 32
PANEL_W = PAGE_W - (2 * PANEL_X)
PANEL_H = PAGE_H - (2 * PANEL_Y)
CONTENT_X = PANEL_X + 24
CONTENT_W = PANEL_W - 48
TOP = PANEL_Y + PANEL_H


# ----- Text helpers -----
def wrap_text(text: str, font_name: str, font_size: float, max_width: float) -> list[str]:
    words = text.split()
    if not words:
        return ['']
    lines: list[str] = []
    current = words[0]
    for word in words[1:]:
        candidate = f"{current} {word}"
        if stringWidth(candidate, font_name, font_size) <= max_width:
            current = candidate
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def trim_lines(lines: list[str], font_name: str, font_size: float, max_width: float, max_lines: int) -> list[str]:
    if len(lines) <= max_lines:
        return lines
    clipped = lines[:max_lines]
    last = clipped[-1]
    while last and stringWidth(f"{last}...", font_name, font_size) > max_width:
        last = last[:-1]
    clipped[-1] = f"{last.rstrip()}..."
    return clipped


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y_top: float,
    width: float,
    font_name: str,
    font_size: float,
    color: colors.Color,
    leading: float,
    max_lines: Optional[int] = None,
) -> float:
    lines = wrap_text(text, font_name, font_size, width)
    if max_lines is not None:
        lines = trim_lines(lines, font_name, font_size, width, max_lines)

    c.setFillColor(color)
    c.setFont(font_name, font_size)
    y = y_top
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


# ----- Drawing helpers -----
def interpolate_color(c1: colors.Color, c2: colors.Color, t: float) -> colors.Color:
    return colors.Color(
        c1.red + (c2.red - c1.red) * t,
        c1.green + (c2.green - c1.green) * t,
        c1.blue + (c2.blue - c1.blue) * t,
        alpha=1,
    )


def gradient_at(t: float) -> colors.Color:
    t = max(0.0, min(1.0, t))
    if t <= 1 / 3:
        return interpolate_color(BRAND[0], BRAND[1], t * 3)
    if t <= 2 / 3:
        return interpolate_color(BRAND[1], BRAND[2], (t - 1 / 3) * 3)
    return interpolate_color(BRAND[2], BRAND[3], (t - 2 / 3) * 3)


def draw_gradient_outline_box(c: canvas.Canvas, x: float, y: float, w: float, h: float, radius: float = 0.0, inset: float = 1.2) -> None:
    path = c.beginPath()
    if radius > 0:
        path.roundRect(x, y, w, h, radius)
    else:
        path.rect(x, y, w, h)

    c.saveState()
    c.clipPath(path, stroke=0, fill=0)
    steps = max(100, int(w * 0.8))
    step_w = w / steps
    for i in range(steps):
        t = i / max(1, (steps - 1))
        c.setFillColor(gradient_at(t))
        c.rect(x + (i * step_w), y, step_w + 0.8, h, fill=1, stroke=0)
    c.restoreState()

    c.setFillColor(PANEL)
    if radius > 0:
        c.roundRect(x + inset, y + inset, w - (2 * inset), h - (2 * inset), max(0.5, radius - inset), fill=1, stroke=0)
    else:
        c.rect(x + inset, y + inset, w - (2 * inset), h - (2 * inset), fill=1, stroke=0)


def draw_section_label(c: canvas.Canvas, text: str, y: float) -> None:
    c.setFillColor(TEXT)
    c.setFont(SANS_SEMIBOLD, 10.2)
    c.drawString(CONTENT_X, y, text.upper())


def draw_dot_divider(c: canvas.Canvas, y: float) -> None:
    positions = [0.22, 0.4, 0.58, 0.76]
    size = 6
    for i, pos in enumerate(positions):
        x = CONTENT_X + (CONTENT_W * pos)
        c.setFillColor(BRAND[i])
        c.roundRect(x, y, size, size, 1.5, fill=1, stroke=0)


BRAND_MARK_RECTS: list[tuple[float, float, colors.Color]] = [
    (0.8, 7.8, BRAND[0]),
    (7.8, 14.8, BRAND[1]),
    (14.8, 7.8, BRAND[2]),
    (21.8, 0.8, BRAND[3]),
]


def draw_brand_mark(c: canvas.Canvas, x: float, y: float, size: float) -> None:
    view_w = 30.0
    view_h = 24.0
    block = 6.4
    corner = 2.0
    scale = size / view_h

    for bx, by, color in BRAND_MARK_RECTS:
        c.setFillColor(color)
        # Convert SVG top-left coordinates into ReportLab bottom-left coordinates.
        y_bottom = (view_h - (by + block)) * scale
        c.roundRect(
            x + (bx * scale),
            y + y_bottom,
            block * scale,
            block * scale,
            corner * scale,
            fill=1,
            stroke=0,
        )


def draw_card(c: canvas.Canvas, x: float, y: float, w: float, h: float, title: str, body: str, lines: int = 4) -> None:
    draw_gradient_outline_box(c, x, y, w, h, inset=1.1)
    c.setFillColor(TEXT)
    c.setFont(SANS_SEMIBOLD, 9.4)
    c.drawString(x + 10, y + h - 17, title.upper())
    draw_wrapped(c, body, x + 10, y + h - 33, w - 20, SANS, 10.2, TEXT, 12, max_lines=lines)


def draw_step(c: canvas.Canvas, x: float, y: float, w: float, h: float, step: int, title: str, body: str, color: colors.Color) -> None:
    draw_gradient_outline_box(c, x, y, w, h, inset=1.1)
    c.setFillColor(TEXT)
    c.setFont(SANS_SEMIBOLD, 10.4)
    c.drawString(x + 10, y + h - 17, f'{step}. {title}')
    draw_wrapped(c, body, x + 10, y + h - 36, w - 20, SANS, 9.8, TEXT, 11.5, max_lines=3)


# ----- Compose page -----
c = canvas.Canvas(str(OUTPUT), pagesize=letter)
c.setTitle('Endpoint Arena')
c.setSubject('Endpoint Arena one-page app summary')
c.setAuthor('Endpoint Arena')
c.setCreator('Endpoint Arena')

# Background and main panel
c.setFillColor(BG)
c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

draw_gradient_outline_box(c, PANEL_X, PANEL_Y, PANEL_W, PANEL_H, inset=1.0)

# Top chrome
seg_w = PANEL_W / len(BRAND)
for i, color in enumerate(BRAND):
    c.setFillColor(color)
    c.rect(PANEL_X + i * seg_w, TOP - 4, seg_w, 3.2, fill=1, stroke=0)

# Header
title_y = TOP - 61
logo_size = 26
logo_x = CONTENT_X
logo_y = title_y - 7
draw_brand_mark(c, logo_x, logo_y, logo_size)

c.setFillColor(TEXT)
c.setFont(SANS_SEMIBOLD, 27)
title_x = CONTENT_X + logo_size + 12
c.drawString(title_x, title_y, 'Endpoint Arena')

subtitle_line_1 = 'FDA-outcome prediction market and AI benchmark for biotech event risk.'
subtitle_line_2 = 'Built for hedge funds and pharma teams with AI-agent-friendly, AI-optimized workflows.'
c.setFillColor(MUTED)
c.setFont(SANS, 12)
subtitle_y_1 = title_y - 21
subtitle_line_gap = 18
c.drawString(title_x, subtitle_y_1, subtitle_line_1)
c.drawString(title_x, subtitle_y_1 - subtitle_line_gap, subtitle_line_2)

c.setStrokeColor(BORDER)
c.setLineWidth(0.9)
c.line(CONTENT_X, title_y - 56, CONTENT_X + CONTENT_W, title_y - 56)

# Row 1 cards
card_gap = 12
top_card_h = 94
top_card_w = (CONTENT_W - card_gap) / 2
top_card_y = title_y - 74 - top_card_h
divider_gap = 18
section_label_offset = 36

draw_card(
    c,
    CONTENT_X,
    top_card_y,
    top_card_w,
    top_card_h,
    'What it is',
    'A live FDA-outcome prediction market with side-by-side AI benchmarking. Models and participants forecast before decisions, then real outcomes resolve and score every forecast.',
    lines=4,
)
draw_card(
    c,
    CONTENT_X + top_card_w + card_gap,
    top_card_y,
    top_card_w,
    top_card_h,
    'Who it is for',
    'Event-driven hedge funds, biotech investors, and pharma teams managing binary FDA catalyst risk.',
    lines=4,
)

# Divider between sections
draw_dot_divider(c, top_card_y - divider_gap)

# How it works
steps_label_y = top_card_y - section_label_offset
draw_section_label(c, 'How it works', steps_label_y)

step_h = 68
step_gap = 10
step_w = (CONTENT_W - (2 * step_gap)) / 3
step_y = steps_label_y - 18 - step_h

draw_step(c, CONTENT_X, step_y, step_w, step_h, 1, 'Predict', 'Models forecast before outcomes.', BRAND[3])
draw_step(c, CONTENT_X + step_w + step_gap, step_y, step_w, step_h, 2, 'Resolve', 'Real FDA outcomes score every forecast.', BRAND[1])
draw_step(c, CONTENT_X + (step_w + step_gap) * 2, step_y, step_w, step_h, 3, 'Improve', 'Rankings and market signals update for everyone.', BRAND[2])

# Divider between sections
draw_dot_divider(c, step_y - divider_gap)

# What it does
feat_label_y = step_y - section_label_offset
draw_section_label(c, 'What it does', feat_label_y)

left_items = [
    'Benchmarks model forecasts on live FDA events.',
    'Publishes accuracy-based rankings over time.',
    'Runs a betting-style prediction market layer on FDA outcomes.',
]
right_items = [
    'Uses market pricing to capture collective belief.',
    'Hedge fund use case to hedge biotech catalyst risk around FDA events.',
    'Flags model disagreement so teams can hedge earlier and size risk better.',
]

col_gap = 16
col_w = (CONTENT_W - col_gap) / 2
feat_box_h = 122
feat_box_y = feat_label_y - 12 - feat_box_h

draw_gradient_outline_box(c, CONTENT_X, feat_box_y, col_w, feat_box_h, inset=1.1)
draw_gradient_outline_box(c, CONTENT_X + col_w + col_gap, feat_box_y, col_w, feat_box_h, inset=1.1)

bullet_top = feat_box_y + feat_box_h - 18

def draw_bullets(items: list[str], x: float) -> None:
    y = bullet_top
    for item in items:
        # Draw a true bullet marker instead of a dash glyph.
        c.setFillColor(MUTED)
        c.rect(x + 12.6, y + 2.1, 3.0, 3.0, fill=1, stroke=0)
        y = draw_wrapped(c, item, x + 24, y, col_w - 34, SANS, 10.7, TEXT, 13.2, max_lines=2)
        y -= 8

draw_bullets(left_items, CONTENT_X)
draw_bullets(right_items, CONTENT_X + col_w + col_gap)

# Divider between sections
draw_dot_divider(c, feat_box_y - divider_gap)

# Customer and market
core_label_y = feat_box_y - section_label_offset
draw_section_label(c, 'Customer and Market', core_label_y)

core_h = 96
core_gap = 10
core_w = (CONTENT_W - (2 * core_gap)) / 3
core_y = core_label_y - 18 - core_h

draw_card(
    c,
    CONTENT_X,
    core_y,
    core_w,
    core_h,
    'Pain point',
    'FDA catalysts are binary and narrative-heavy. Teams struggle to price risk with consistent probabilities.',
    lines=4,
)
draw_card(
    c,
    CONTENT_X + core_w + core_gap,
    core_y,
    core_w,
    core_h,
    'Customer',
    'Hedge-fund PMs, biotech analysts, and strategy teams needing earlier, quantified decision signals.',
    lines=4,
)
draw_card(
    c,
    CONTENT_X + (core_w + core_gap) * 2,
    core_y,
    core_w,
    core_h,
    'New market',
    'Institutional science-risk intelligence with calibrated probabilities, positions, and resolved performance history.',
    lines=4,
)

if core_y < PANEL_Y + 10:
    raise RuntimeError('Content overflowed single page')

c.showPage()
c.save()
print(OUTPUT)
