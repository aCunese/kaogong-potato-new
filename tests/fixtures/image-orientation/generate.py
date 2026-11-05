"""Generate public synthetic OCR evidence; contains no application data."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent
font = ImageFont.truetype('/System/Library/Fonts/STHeiti Medium.ttc', 36)
image = Image.new('RGB', (1120, 1030), 'white')
draw = ImageDraw.Draw(image)
lines = [
    '每日学习计划与练习记录',
    '阅读材料后回答问题，选择最合适的答案。',
    '公共服务需要准确理解群众的实际需求。',
    '科学研究通过观察、比较和分析形成结论。',
    '学习方法应当结合目标，合理安排复习时间。',
    '坚持记录每天进度，及时总结出现的错误。',
    '知识之间存在联系，也需要独立思考问题。',
    '认真阅读题目条件，再逐步计算最终结果。',
    '良好的学习习惯能够提高理解和表达能力。',
    'Practice makes progress through careful reading.',
    'Review the question and select the correct answer.',
    'Daily study records help improve future learning.',
]
for index, line in enumerate(lines):
    draw.text((45, 40 + index * 78), line, font=font, fill='black')
image.save(root / 'study-page.png')
Image.new('RGB', (400, 400), 'white').save(root / 'blank.png')

# A diagram-only question with four option labels must not count as enough text.
font = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 28)
image = Image.new('RGB', (1200, 900), 'white')
draw = ImageDraw.Draw(image)
for row in range(2):
    for column in range(5 if row == 0 else 4):
        x, y = 80 + column * 220, 100 + row * 420
        if row == 1:
            draw.text((x + 75, y + 220), 'ABCD'[column], font=font, fill='black')
        draw.rectangle((x, y, x + 180, y + 180), outline='black', width=3)
        draw.polygon([(x + 90, y + 20), (x + 155, y + 150), (x + 25, y + 150)], outline='black', width=4)
image.save(root / 'lowtext-diagrams.png')
