/**
 * Generate animated SVG desk-pet assets for 炼丹少年 (danchen).
 * Chibi proportions + teal/white palette matched to theme art.
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'themes', 'danchen', 'assets');

const CSS_BASE = `
  .breathe { transform-origin: 256px 420px; animation: breathe 3.4s ease-in-out infinite; }
  @keyframes breathe {
    0%,100% { transform: translateY(0) scale(1,1); }
    50% { transform: translateY(2px) scale(1.01,0.985); }
  }
  .blink { transform-origin: 256px 168px; animation: blink 5s ease-in-out infinite; }
  @keyframes blink {
    0%,8%,100% { transform: scaleY(1); }
    4% { transform: scaleY(0.08); }
  }
  .ahoge { transform-origin: 268px 78px; animation: ahoge 2.6s ease-in-out infinite; }
  @keyframes ahoge {
    0%,100% { transform: rotate(-4deg); }
    50% { transform: rotate(10deg); }
  }
  .ponytail { transform-origin: 300px 110px; animation: ponytail 3.2s ease-in-out infinite; }
  @keyframes ponytail {
    0%,100% { transform: rotate(0deg); }
    50% { transform: rotate(6deg); }
  }
  .ribbon { transform-origin: 318px 118px; animation: ribbon 2.4s ease-in-out infinite; }
  @keyframes ribbon {
    0%,100% { transform: rotate(-4deg); }
    50% { transform: rotate(8deg); }
  }
  .gourd { transform-origin: 318px 290px; animation: gourd 2.8s ease-in-out infinite; }
  @keyframes gourd {
    0%,100% { transform: rotate(-6deg); }
    50% { transform: rotate(8deg); }
  }
  .sleeve { transform-origin: 180px 260px; animation: sleeve 3s ease-in-out infinite; }
  .sleeve-r { transform-origin: 330px 260px; animation: sleeve 3s ease-in-out infinite 0.15s; }
  @keyframes sleeve {
    0%,100% { transform: rotate(0deg); }
    50% { transform: rotate(3deg); }
  }
`;

const CSS_LISTEN = `
  .breathe { transform-origin: 256px 420px; animation: beat 0.7s ease-in-out infinite; }
  @keyframes beat {
    0%,100% { transform: translateY(0) rotate(0deg) scale(1,1); }
    50% { transform: translateY(3px) rotate(-1.5deg) scale(1.012,0.988); }
  }
  .note { transform-box: fill-box; transform-origin: center; animation: note 2.2s ease-in-out infinite; }
  .note-b { animation-delay: .45s; }
  .note-c { animation-delay: .9s; }
  @keyframes note {
    0% { transform: translateY(0) scale(.8) rotate(-8deg); opacity: 0; }
    25% { opacity: 1; }
    100% { transform: translateY(-48px) scale(1.1) rotate(12deg); opacity: 0; }
  }
  .hp { transform-origin: 256px 150px; animation: hp 0.7s ease-in-out infinite; }
  @keyframes hp {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(2px); }
  }
`;

const CSS_ALCHEMY = `
  .breathe { transform-origin: 256px 380px; animation: meditate 3.6s ease-in-out infinite; }
  @keyframes meditate {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(2px); }
  }
  .vapor { animation: vapor 2.8s ease-in-out infinite; }
  .vapor-b { animation-delay: .5s; }
  .vapor-c { animation-delay: 1s; }
  @keyframes vapor {
    0% { transform: translate(0,8px) scale(.9); opacity: .2; }
    45% { opacity: .85; }
    100% { transform: translate(6px,-36px) scale(1.15); opacity: 0; }
  }
  .spark { animation: spark 1.6s ease-in-out infinite; }
  .spark-b { animation-delay: .4s; }
  .spark-c { animation-delay: .9s; }
  @keyframes spark {
    0%,100% { opacity: .15; transform: scale(.7); }
    50% { opacity: 1; transform: scale(1.15); }
  }
  .pour { animation: pour 1.2s ease-in-out infinite; }
  @keyframes pour {
    0%,100% { transform: translateY(0); opacity: .55; }
    50% { transform: translateY(6px); opacity: 1; }
  }
`;

const CSS_FUNNY = `
  .breathe { transform-origin: 256px 420px; animation: wiggle 0.55s ease-in-out infinite; }
  @keyframes wiggle {
    0%,100% { transform: rotate(-1.5deg); }
    50% { transform: rotate(1.5deg); }
  }
  .star { animation: twinkle 1.1s ease-in-out infinite; }
  .star-b { animation-delay: .35s; }
  .star-c { animation-delay: .7s; }
  @keyframes twinkle {
    0%,100% { opacity: .25; transform: scale(.7) rotate(0deg); }
    50% { opacity: 1; transform: scale(1.2) rotate(18deg); }
  }
`;

const CSS_DRAG = `
  .breathe { transform-origin: 256px 280px; animation: float 1.4s ease-in-out infinite; }
  @keyframes float {
    0%,100% { transform: translateY(0) rotate(-4deg); }
    50% { transform: translateY(-10px) rotate(3deg); }
  }
  .trail { animation: trail 1s ease-in-out infinite; }
  @keyframes trail {
    0%,100% { opacity: .15; }
    50% { opacity: .55; }
  }
`;

const CSS_EAT = `
  .breathe { transform-origin: 256px 420px; animation: lean 1.8s ease-in-out infinite; }
  @keyframes lean {
    0%,100% { transform: translateY(0) rotate(0); }
    50% { transform: translateY(1px) rotate(-1deg); }
  }
  .jaw { transform-origin: 256px 195px; animation: chew 0.38s ease-in-out infinite; }
  @keyframes chew {
    0%,100% { transform: translateY(0) scaleY(1); }
    50% { transform: translateY(3px) scaleY(.92); }
  }
`;

const CSS_SLEEP = `
  .breathe { transform-origin: 256px 360px; animation: snooze 4s ease-in-out infinite; }
  @keyframes snooze {
    0%,100% { transform: translateY(0); }
    50% { transform: translateY(2px); }
  }
  .zzz { animation: zzz 2.4s ease-in-out infinite; }
  .zzz-b { animation-delay: .6s; }
  @keyframes zzz {
    0% { transform: translate(0,0) scale(.7); opacity: 0; }
    30% { opacity: .9; }
    100% { transform: translate(10px,-34px) scale(1.1); opacity: 0; }
  }
  .bird { transform-origin: 150px 390px; animation: bird 2.2s ease-in-out infinite; }
  @keyframes bird {
    0%,100% { transform: translateY(0) scale(1,1); }
    50% { transform: translateY(-3px) scale(1.03,.97); }
  }
`;

const CSS_MINI = `
  .breathe { transform-origin: 256px 300px; animation: peek 2s ease-in-out infinite; }
  @keyframes peek {
    0%,100% { transform: translateY(8px) rotate(6deg); }
    50% { transform: translateY(0) rotate(2deg); }
  }
  .sparkle { animation: sparkle 1.4s ease-in-out infinite; }
  .sparkle-b { animation-delay: .4s; }
  @keyframes sparkle {
    0%,100% { opacity: .2; }
    50% { opacity: 1; }
  }
`;

function note(x, y, cls = 'note', s = 1) {
  return `<g class="${cls}" transform="translate(${x},${y}) scale(${s})">
    <ellipse cx="0" cy="10" rx="7" ry="5" transform="rotate(-18)" fill="#3D2A1F"/>
    <rect x="5" y="-14" width="3" height="22" rx="1" fill="#3D2A1F"/>
    <path d="M8 -14 C18 -18 22 -8 12 -4" fill="none" stroke="#3D2A1F" stroke-width="2.5"/>
  </g>`;
}

function spark(x, y, cls = 'spark', color = '#F6D96A') {
  return `<g class="${cls}" transform="translate(${x},${y})">
    <path d="M0-8 L2-2 L8 0 L2 2 L0 8 L-2 2 L-8 0 L-2-2 Z" fill="${color}"/>
  </g>`;
}

function headphones() {
  return `<g class="hp">
    <path d="M178 145 C178 95 210 72 256 72 C302 72 334 95 334 145" fill="none" stroke="#F3E8D8" stroke-width="16" stroke-linecap="round"/>
    <path d="M178 145 C178 95 210 72 256 72 C302 72 334 95 334 145" fill="none" stroke="#8B6A4A" stroke-width="7" stroke-linecap="round"/>
    <ellipse cx="172" cy="168" rx="28" ry="32" fill="#F3E8D8" stroke="#5C3A28" stroke-width="4"/>
    <ellipse cx="172" cy="168" rx="16" ry="18" fill="#6B4A35"/>
    <ellipse cx="340" cy="168" rx="28" ry="32" fill="#F3E8D8" stroke="#5C3A28" stroke-width="4"/>
    <ellipse cx="340" cy="168" rx="16" ry="18" fill="#6B4A35"/>
  </g>`;
}

function bird(x = 148, y = 392) {
  return `<g class="bird" transform="translate(${x},${y})">
    <ellipse cx="0" cy="8" rx="28" ry="24" fill="#FFF8F0" stroke="#5C3A28" stroke-width="3"/>
    <ellipse cx="-18" cy="2" rx="10" ry="8" fill="#8FD4C8" stroke="#5C3A28" stroke-width="2"/>
    <ellipse cx="18" cy="2" rx="10" ry="8" fill="#8FD4C8" stroke="#5C3A28" stroke-width="2"/>
    <path d="M-6 -18 Q0 -30 6 -18" fill="#8FD4C8" stroke="#5C3A28" stroke-width="2"/>
    <circle cx="-8" cy="2" r="3.2" fill="#2A1A12"/>
    <circle cx="8" cy="2" r="3.2" fill="#2A1A12"/>
    <circle cx="-7" cy="1" r="1" fill="#fff"/>
    <circle cx="9" cy="1" r="1" fill="#fff"/>
    <ellipse cx="0" cy="10" rx="4" ry="3" fill="#F0A060"/>
    <ellipse cx="-10" cy="28" rx="4" ry="3" fill="#E07A40"/>
    <ellipse cx="10" cy="28" rx="4" ry="3" fill="#E07A40"/>
  </g>`;
}

/**
 * Core character layers. opts control pose / face / extras.
 */
function character(opts = {}) {
  const {
    pose = 'stand', // stand | point | sit | funny | drag | alchemy | eat | mini
    mouth = 'smile', // smile | open | chew | pout | funny | closed
    eyes = 'open', // open | wink | closed | happy
    leftArm = 'hip', // hip | fist | point | pull | flask | up | wave
    rightArm = 'fist',
    showBird = false,
    showHp = false,
    showNotes = false,
    showVapor = false,
    showStars = false,
    showZzz = false,
    showTrail = false,
    showSparkles = false,
    jawClass = '',
  } = opts;

  const faceY = pose === 'sit' || pose === 'alchemy' ? 150 : 155;
  const bodyY = pose === 'sit' || pose === 'alchemy' ? 250 : 255;

  // Legs / lower body
  let lower = '';
  if (pose === 'sit' || pose === 'alchemy') {
    lower = `
      <ellipse cx="210" cy="390" rx="42" ry="18" fill="#F7F4EE" stroke="#3D2A1F" stroke-width="3.5"/>
      <ellipse cx="302" cy="390" rx="42" ry="18" fill="#F7F4EE" stroke="#3D2A1F" stroke-width="3.5"/>
      <ellipse cx="188" cy="402" rx="16" ry="10" fill="#2A2A2A"/>
      <ellipse cx="324" cy="402" rx="16" ry="10" fill="#2A2A2A"/>
      <rect x="182" y="392" width="14" height="6" rx="2" fill="#D4AF37"/>
      <rect x="318" y="392" width="14" height="6" rx="2" fill="#D4AF37"/>
    `;
  } else if (pose === 'mini') {
    lower = `
      <ellipse cx="256" cy="360" rx="48" ry="22" fill="#F7F4EE" stroke="#3D2A1F" stroke-width="3"/>
    `;
  } else {
    lower = `
      <path d="M220 330 Q210 380 200 430" fill="none" stroke="#F7F4EE" stroke-width="28" stroke-linecap="round"/>
      <path d="M292 330 Q302 380 312 430" fill="none" stroke="#F7F4EE" stroke-width="28" stroke-linecap="round"/>
      <path d="M220 330 Q210 380 200 430" fill="none" stroke="#3D2A1F" stroke-width="3.5" stroke-linecap="round" opacity=".35"/>
      <path d="M292 330 Q302 380 312 430" fill="none" stroke="#3D2A1F" stroke-width="3.5" stroke-linecap="round" opacity=".35"/>
      <path d="M186 430 L214 430 L218 448 L182 448 Z" fill="#2A2A2A"/>
      <path d="M298 430 L326 430 L330 448 L294 448 Z" fill="#2A2A2A"/>
      <rect x="190" y="430" width="20" height="5" fill="#D4AF37"/>
      <rect x="302" y="430" width="20" height="5" fill="#D4AF37"/>
    `;
  }

  // Arms
  const arm = (side, kind) => {
    const isL = side === 'left';
    const ox = isL ? 198 : 314;
    const sleeveCls = isL ? 'sleeve' : 'sleeve-r';
    if (kind === 'hip') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 255 Q${isL ? 160 : 352} 290 ${isL ? 170 : 342} 330" fill="none" stroke="#F7F4EE" stroke-width="26" stroke-linecap="round"/>
        <path d="M${ox} 255 Q${isL ? 160 : 352} 290 ${isL ? 170 : 342} 330" fill="none" stroke="#6DB8B0" stroke-width="8" stroke-linecap="round" opacity=".55"/>
        <circle cx="${isL ? 168 : 344}" cy="334" r="12" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
      </g>`;
    }
    if (kind === 'fist') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 250 Q${isL ? 210 : 302} 270 ${isL ? 230 : 282} 248" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
        <path d="M${ox} 250 Q${isL ? 210 : 302} 270 ${isL ? 230 : 282} 248" fill="none" stroke="#6DB8B0" stroke-width="7" stroke-linecap="round" opacity=".5"/>
        <circle cx="${isL ? 232 : 280}" cy="246" r="13" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
      </g>`;
    }
    if (kind === 'point') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 250 Q${isL ? 200 : 312} 210 ${isL ? 210 : 302} 170" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
        <path d="M${ox} 250 Q${isL ? 200 : 312} 210 ${isL ? 210 : 302} 170" fill="none" stroke="#6DB8B0" stroke-width="7" stroke-linecap="round" opacity=".5"/>
        <circle cx="${isL ? 210 : 302}" cy="168" r="11" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
        <rect x="${isL ? 206 : 298}" y="140" width="7" height="22" rx="3" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2"/>
      </g>`;
    }
    if (kind === 'pull') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 250 Q${isL ? 220 : 292} 230 ${isL ? 228 : 284} 200" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
        <circle cx="${isL ? 230 : 282}" cy="196" r="11" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
        <path d="M${isL ? 236 : 276} 196 L${isL ? 248 : 264} 188" stroke="#F5D5C0" stroke-width="6" stroke-linecap="round"/>
      </g>`;
    }
    if (kind === 'flask') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 260 Q${isL ? 170 : 342} 300 ${isL ? 150 : 362} 330" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
        <circle cx="${isL ? 148 : 364}" cy="334" r="11" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
        <g transform="translate(${isL ? 130 : 346},310)">
          <ellipse cx="10" cy="8" rx="16" ry="14" fill="#2F6B5E" stroke="#1E3D36" stroke-width="2.5"/>
          <rect x="4" y="-6" width="12" height="12" rx="2" fill="#3D8A7A" stroke="#1E3D36" stroke-width="2"/>
          <g class="pour">
            <path d="M10 20 Q6 34 2 44" stroke="#F6D96A" stroke-width="3" fill="none" stroke-linecap="round"/>
            <circle cx="4" cy="48" r="2.5" fill="#F6D96A"/>
            <circle cx="10" cy="42" r="2" fill="#FFE9A0"/>
          </g>
        </g>
      </g>`;
    }
    if (kind === 'cast') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 250 Q${isL ? 220 : 292} 255 ${isL ? 236 : 276} 240" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
        <circle cx="${isL ? 238 : 274}" cy="238" r="12" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
      </g>`;
    }
    if (kind === 'up') {
      return `<g class="${sleeveCls}">
        <path d="M${ox} 250 Q${isL ? 180 : 332} 200 ${isL ? 190 : 322} 150" fill="none" stroke="#F7F4EE" stroke-width="26" stroke-linecap="round"/>
        <circle cx="${isL ? 190 : 322}" cy="146" r="12" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
      </g>`;
    }
    // wave / default
    return `<g class="${sleeveCls}">
      <path d="M${ox} 250 Q${isL ? 150 : 362} 240 ${isL ? 140 : 372} 210" fill="none" stroke="#F7F4EE" stroke-width="24" stroke-linecap="round"/>
      <circle cx="${isL ? 138 : 374}" cy="208" r="12" fill="#F5D5C0" stroke="#3D2A1F" stroke-width="2.5"/>
    </g>`;
  };

  // Eyes
  let eyeMarkup = '';
  if (eyes === 'closed' || eyes === 'happy') {
    eyeMarkup = `
      <path d="M210 168 Q226 158 242 168" fill="none" stroke="#3D2A1F" stroke-width="4.5" stroke-linecap="round"/>
      <path d="M270 168 Q286 158 302 168" fill="none" stroke="#3D2A1F" stroke-width="4.5" stroke-linecap="round"/>
    `;
  } else if (eyes === 'wink') {
    eyeMarkup = `
      <g class="blink">
        <ellipse cx="226" cy="168" rx="16" ry="18" fill="#5C3A28"/>
        <ellipse cx="221" cy="162" rx="5" ry="4" fill="#fff"/>
        <ellipse cx="232" cy="174" rx="2.2" ry="1.8" fill="#fff" opacity=".55"/>
      </g>
      <path d="M270 168 Q286 158 302 168" fill="none" stroke="#3D2A1F" stroke-width="4.5" stroke-linecap="round"/>
    `;
  } else {
    eyeMarkup = `
      <g class="blink">
        <ellipse cx="226" cy="168" rx="16" ry="18" fill="#5C3A28"/>
        <ellipse cx="286" cy="168" rx="16" ry="18" fill="#5C3A28"/>
        <ellipse cx="221" cy="162" rx="5" ry="4" fill="#fff"/>
        <ellipse cx="281" cy="162" rx="5" ry="4" fill="#fff"/>
        <ellipse cx="232" cy="174" rx="2.2" ry="1.8" fill="#fff" opacity=".55"/>
        <ellipse cx="292" cy="174" rx="2.2" ry="1.8" fill="#fff" opacity=".55"/>
      </g>
    `;
  }

  // Mouth
  let mouthMarkup = '';
  if (mouth === 'open') {
    mouthMarkup = `<ellipse class="${jawClass}" cx="256" cy="205" rx="14" ry="16" fill="#3D2A1F"/><ellipse cx="256" cy="210" rx="8" ry="7" fill="#E07A8A"/>`;
  } else if (mouth === 'chew') {
    mouthMarkup = `<ellipse class="${jawClass}" cx="256" cy="202" rx="12" ry="8" fill="#3D2A1F"/><path d="M246 198 Q256 206 266 198" fill="none" stroke="#F5D5C0" stroke-width="2"/>`;
  } else if (mouth === 'pout') {
    mouthMarkup = `<ellipse cx="256" cy="200" rx="7" ry="5" fill="#C07070"/><ellipse cx="236" cy="188" rx="10" ry="7" fill="#F5A090" opacity=".7"/><ellipse cx="276" cy="188" rx="10" ry="7" fill="#F5A090" opacity=".7"/>`;
  } else if (mouth === 'funny') {
    mouthMarkup = `
      <path d="M228 198 Q256 230 284 198" fill="#3D2A1F"/>
      <ellipse cx="256" cy="214" rx="10" ry="8" fill="#E07A8A"/>
    `;
  } else if (mouth === 'closed') {
    mouthMarkup = `<path d="M244 200 Q256 206 268 200" fill="none" stroke="#3D2A1F" stroke-width="3" stroke-linecap="round"/>`;
  } else {
    mouthMarkup = `<path d="M242 198 Q256 212 270 198" fill="none" stroke="#3D2A1F" stroke-width="3.5" stroke-linecap="round"/>`;
  }

  const extras = [];
  if (showHp) extras.push(headphones());
  if (showNotes) extras.push(note(360, 120), note(380, 160, 'note-b', 0.85), note(140, 130, 'note-c', 0.9));
  if (showVapor) {
    extras.push(`
      <ellipse class="vapor" cx="200" cy="300" rx="18" ry="10" fill="#A8E6C8" opacity=".7"/>
      <ellipse class="vapor vapor-b" cx="230" cy="280" rx="22" ry="12" fill="#C8F0A8" opacity=".65"/>
      <ellipse class="vapor vapor-c" cx="180" cy="270" rx="14" ry="8" fill="#F6E080" opacity=".7"/>
      <ellipse cx="256" cy="420" rx="70" ry="14" fill="#A8E6C8" opacity=".25"/>
    `);
    extras.push(spark(190, 250, 'spark'), spark(240, 235, 'spark-b'), spark(170, 290, 'spark-c', '#C8F0A8'));
  }
  if (showStars) {
    extras.push(spark(160, 100, 'star', '#F6D96A'), spark(350, 90, 'star-b'), spark(370, 160, 'star-c', '#FFE9A0'));
  }
  if (showZzz) {
    extras.push(`
      <text class="zzz" x="330" y="140" font-family="Segoe UI, sans-serif" font-size="22" font-weight="700" fill="#6DB8B0">z</text>
      <text class="zzz zzz-b" x="348" y="118" font-family="Segoe UI, sans-serif" font-size="28" font-weight="700" fill="#4A9B94">Z</text>
    `);
  }
  if (showTrail) {
    extras.push(`
      <ellipse class="trail" cx="256" cy="460" rx="40" ry="8" fill="#6DB8B0" opacity=".3"/>
      <ellipse class="trail" cx="256" cy="448" rx="28" ry="5" fill="#A8D4E8" opacity=".35"/>
    `);
  }
  if (showSparkles) {
    extras.push(spark(200, 90, 'sparkle'), spark(310, 80, 'sparkle-b'), spark(340, 140, 'sparkle', '#fff'));
  }
  if (showBird) extras.push(bird(pose === 'sit' ? 150 : 145, pose === 'sit' ? 400 : 400));

  const leftKind = leftArm === 'flask' ? 'flask' : leftArm === 'cast' ? 'cast' : leftArm;
  const rightKind = rightArm;

  return `
  <g class="breathe">
    <!-- ponytail behind -->
    <g class="ponytail">
      <path d="M290 105 C340 130 360 200 348 280 C340 330 310 360 290 340 C310 300 320 240 300 170 Z" fill="#3D2A1F"/>
      <path d="M300 120 C330 150 340 210 332 270" fill="none" stroke="#5A4030" stroke-width="6" opacity=".35"/>
    </g>
    <g class="ribbon">
      <path d="M308 112 C330 130 345 170 350 210" fill="none" stroke="#A8D4E8" stroke-width="7" stroke-linecap="round"/>
      <path d="M308 112 C325 140 330 180 322 220" fill="none" stroke="#7EB8D0" stroke-width="5" stroke-linecap="round"/>
    </g>

    ${lower}

    <!-- torso -->
    <ellipse cx="256" cy="${bodyY + 40}" rx="58" ry="70" fill="#F7F4EE" stroke="#3D2A1F" stroke-width="3.5"/>
    <path d="M210 ${bodyY + 10} L256 ${bodyY - 10} L302 ${bodyY + 10}" fill="none" stroke="#6DB8B0" stroke-width="8" stroke-linecap="round"/>
    <path d="M220 ${bodyY + 20} Q256 ${bodyY + 8} 292 ${bodyY + 20}" fill="#8FD4C8" opacity=".55"/>
    <!-- belt -->
    <rect x="214" y="${bodyY + 55}" width="84" height="16" rx="4" fill="#243530" stroke="#1A2420" stroke-width="2"/>
    <circle cx="256" cy="${bodyY + 63}" r="9" fill="#3DA88E" stroke="#D4AF37" stroke-width="2.5"/>
    <rect x="248" y="${bodyY + 70}" width="16" height="28" rx="3" fill="#6DB8B0" opacity=".85"/>

    <g class="gourd">
      <ellipse cx="318" cy="318" rx="12" ry="10" fill="#8FD4C8" stroke="#3D6B60" stroke-width="2"/>
      <ellipse cx="318" cy="336" rx="16" ry="14" fill="#8FD4C8" stroke="#3D6B60" stroke-width="2"/>
      <circle cx="318" cy="304" r="4" fill="#D4AF37"/>
      <path d="M318 348 L318 362" stroke="#8B5A3C" stroke-width="2"/>
      <circle cx="318" cy="366" r="3" fill="#D4AF37"/>
    </g>

    ${arm('left', leftKind)}
    ${arm('right', rightKind)}

    <!-- head -->
    <circle cx="256" cy="${faceY}" r="78" fill="#F8DCC8" stroke="#3D2A1F" stroke-width="3.5"/>
    <!-- hair dome -->
    <path d="M180 ${faceY - 10} C185 ${faceY - 90} 220 ${faceY - 110} 256 ${faceY - 112} C292 ${faceY - 110} 327 ${faceY - 90} 332 ${faceY - 10} C310 ${faceY - 55} 280 ${faceY - 70} 256 ${faceY - 72} C232 ${faceY - 70} 202 ${faceY - 55} 180 ${faceY - 10} Z" fill="#3D2A1F"/>
    <path d="M195 ${faceY - 5} C210 ${faceY + 25} 225 ${faceY + 20} 232 ${faceY - 2}" fill="#3D2A1F"/>
    <path d="M280 ${faceY - 2} C290 ${faceY + 22} 305 ${faceY + 28} 318 ${faceY - 5}" fill="#3D2A1F"/>
    <path d="M240 ${faceY - 8} C248 ${faceY + 18} 260 ${faceY + 18} 268 ${faceY - 8}" fill="#3D2A1F"/>
    <!-- lotus ornament -->
    <g transform="translate(300,${faceY - 70})">
      <ellipse cx="0" cy="0" rx="10" ry="7" fill="#E8F4F0" stroke="#6DB8B0" stroke-width="1.5"/>
      <ellipse cx="-6" cy="2" rx="6" ry="4" fill="#C8E8E0"/>
      <ellipse cx="6" cy="2" rx="6" ry="4" fill="#C8E8E0"/>
    </g>
    <g class="ahoge">
      <path d="M268 ${faceY - 100} C275 ${faceY - 130} 255 ${faceY - 140} 250 ${faceY - 120}" fill="none" stroke="#3D2A1F" stroke-width="7" stroke-linecap="round"/>
    </g>

    <!-- blush -->
    <ellipse cx="210" cy="${faceY + 28}" rx="12" ry="7" fill="#F5A090" opacity=".55"/>
    <ellipse cx="302" cy="${faceY + 28}" rx="12" ry="7" fill="#F5A090" opacity=".55"/>

    ${eyeMarkup}
    ${mouthMarkup}

    ${extras.join('\n')}
  </g>`;
}

function wrap(css, body, title = 'danchen') {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" overflow="hidden">
  <title>${title}</title>
  <defs><style>${CSS_BASE}
${css}
  </style></defs>
  ${body}
</svg>
`;
}

const files = {
  'idle-1.svg': wrap(
    '',
    character({ pose: 'stand', mouth: 'pout', leftArm: 'hip', rightArm: 'fist' }),
    'idle'
  ),
  'idle-2.svg': wrap(
    '',
    character({ pose: 'stand', mouth: 'smile', leftArm: 'hip', rightArm: 'point', showBird: true, showSparkles: true }),
    'idle-anim'
  ),
  'funny.svg': wrap(
    CSS_FUNNY,
    character({ pose: 'stand', mouth: 'funny', eyes: 'wink', leftArm: 'pull', rightArm: 'pull', showStars: true }),
    'funny'
  ),
  'drag.svg': wrap(
    CSS_DRAG,
    character({ pose: 'stand', mouth: 'pout', leftArm: 'up', rightArm: 'up', showTrail: true }),
    'drag'
  ),
  'alchemy.svg': wrap(
    CSS_ALCHEMY,
    character({
      pose: 'alchemy',
      mouth: 'open',
      leftArm: 'flask',
      rightArm: 'cast',
      showVapor: true,
    }),
    'alchemy'
  ),
  'listening.svg': wrap(
    CSS_LISTEN,
    character({
      pose: 'stand',
      mouth: 'smile',
      leftArm: 'hip',
      rightArm: 'fist',
      showHp: true,
      showNotes: true,
    }),
    'listening'
  ),
  'eat-open.svg': wrap(
    CSS_EAT,
    character({ pose: 'stand', mouth: 'open', leftArm: 'fist', rightArm: 'fist', jawClass: 'jaw' }),
    'eat-open'
  ),
  'eat-chew.svg': wrap(
    CSS_EAT,
    character({ pose: 'stand', mouth: 'chew', leftArm: 'fist', rightArm: 'fist', jawClass: 'jaw' }),
    'eat-chew'
  ),
  'eat-chew2.svg': wrap(
    CSS_EAT.replace('0.38s', '0.42s'),
    character({ pose: 'stand', mouth: 'chew', eyes: 'happy', leftArm: 'fist', rightArm: 'hip', jawClass: 'jaw' }),
    'eat-chew2'
  ),
  'eat-chew3.svg': wrap(
    CSS_EAT.replace('0.38s', '0.34s'),
    character({ pose: 'stand', mouth: 'chew', leftArm: 'hip', rightArm: 'fist', jawClass: 'jaw' }),
    'eat-chew3'
  ),
  'sit.svg': wrap(
    CSS_SLEEP,
    character({
      pose: 'sit',
      mouth: 'closed',
      eyes: 'closed',
      leftArm: 'hip',
      rightArm: 'point',
      showBird: true,
      showZzz: true,
    }),
    'sit'
  ),
  'mini.svg': wrap(
    CSS_MINI,
    character({
      pose: 'mini',
      mouth: 'open',
      eyes: 'happy',
      leftArm: 'wave',
      rightArm: 'wave',
      showSparkles: true,
    }),
    'mini'
  ),
};

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svg] of Object.entries(files)) {
  const p = path.join(OUT, name);
  fs.writeFileSync(p, svg, 'utf8');
  console.log('wrote', name, Buffer.byteLength(svg), 'bytes');
}
console.log('done', Object.keys(files).length, 'svgs');
