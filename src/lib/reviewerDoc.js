// Builds the pdfmake document definition for the reviewer ("colorful study notes" style).
// Pure function: no browser APIs, so it can be tested in Node.

const C = {
  ink: '#1E1B2E',
  muted: '#6B6785',
  line: '#E5E3F0',
  accent: '#4F46E5',
  accentSoft: '#EEF0FF',
  highlight: '#FDE68A',
  ok: '#15803D',
  okSoft: '#ECFDF3',
  zebra: '#F8F8FC',
};
const TOPIC_COLORS = ['#4F46E5', '#0E7490', '#BE185D', '#C2410C', '#15803D', '#7C3AED', '#0369A1', '#A16207'];
const LETTERS = ['A', 'B', 'C', 'D'];

/** "a ==key== b" -> pdfmake inline spans with the key words highlighted. */
export function highlight(text, base = {}) {
  const parts = String(text).split(/==(.+?)==/g);
  return parts
    .map((t, i) => (i % 2 === 1
      ? { text: t, background: C.highlight, bold: true, ...base }
      : { text: t, ...base }))
    .filter((p) => p.text !== '');
}
const plain = (text) => String(text).replace(/==/g, '');

function shuffle(arr, rand) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function shuffleChoices(q, rand) {
  const correct = q.choices[LETTERS.indexOf(q.answer)];
  const choices = shuffle(q.choices, rand);
  return { ...q, choices, answer: LETTERS[choices.indexOf(correct)] };
}

function sectionHeader(num, title, subtitle, pageBreak = true) {
  return {
    pageBreak: pageBreak ? 'before' : undefined,
    margin: [0, 0, 0, 18],
    table: {
      widths: ['auto', '*'],
      body: [[
        { text: String(num).padStart(2, '0'), color: '#FFFFFF', fontSize: 22, bold: true, margin: [14, 12, 6, 12] },
        {
          stack: [
            { text: title, color: '#FFFFFF', fontSize: 20, bold: true },
            { text: subtitle, color: '#DCDDFE', fontSize: 10, margin: [0, 2, 0, 0] },
          ],
          margin: [6, 11, 14, 11],
        },
      ]],
    },
    layout: { fillColor: C.accent, hLineWidth: () => 0, vLineWidth: () => 0 },
  };
}

function topicBlock(topic, color) {
  const block = [
    {
      margin: [0, 6, 0, 8],
      table: {
        widths: [4, '*'],
        body: [[
          { text: '', fillColor: color },
          { text: topic.heading, fontSize: 14, bold: true, color, margin: [10, 3, 0, 3] },
        ]],
      },
      layout: 'noBorders',
    },
    {
      ul: topic.points.map((p) => ({ text: highlight(p), margin: [0, 0, 0, 4] })),
      markerColor: color,
      margin: [14, 0, 0, 6],
      lineHeight: 1.25,
    },
  ];
  if (topic.remember) {
    block.push({
      margin: [14, 2, 0, 16],
      table: {
        widths: ['*'],
        body: [[{
          stack: [
            { text: 'REMEMBER', fontSize: 8, bold: true, color, characterSpacing: 1.2 },
            { text: highlight(topic.remember), fontSize: 10.5, margin: [0, 3, 0, 0], lineHeight: 1.2 },
          ],
          margin: [10, 8, 10, 8],
        }]],
      },
      layout: {
        fillColor: () => color,
        fillOpacity: () => 0.08,
        hLineWidth: () => 0,
        vLineWidth: (i) => (i === 0 ? 3 : 0),
        vLineColor: () => color,
      },
    });
  } else {
    block.push({ text: '', margin: [0, 0, 0, 10] });
  }
  return { stack: block, unbreakable: topic.points.length <= 6 };
}

/**
 * @param {{titles: string[], topics: object[], terms: object[], scenarios: object[], models?: string[]}} data
 * @param {{fileNames?: string[], date?: Date, random?: () => number}} [opts]
 */
export function buildReviewerDoc(data, { fileNames = [], date = new Date(), random = Math.random } = {}) {
  const topicColor = new Map(data.topics.map((t, i) => [t.heading.toLowerCase(), TOPIC_COLORS[i % TOPIC_COLORS.length]]));
  const colorFor = (heading) => topicColor.get(String(heading).toLowerCase()) || C.accent;
  const scenarios = data.scenarios.map((q) => shuffleChoices(q, random));
  const title = data.titles.length ? data.titles.join(' · ') : 'Handout Reviewer';
  const dateText = date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  // ---------- Cover
  const stat = (n, label) => ({
    stack: [
      { text: String(n), fontSize: 26, bold: true, color: C.accent, alignment: 'center' },
      { text: label, fontSize: 9.5, color: C.muted, alignment: 'center', margin: [0, 2, 0, 0] },
    ],
    margin: [0, 12, 0, 12],
  });
  const cover = [
    { text: 'EXAM REVIEWER', color: '#C7CAFF', fontSize: 10, bold: true, characterSpacing: 2, margin: [0, 34, 0, 10] },
    { text: title, color: '#FFFFFF', fontSize: 28, bold: true, lineHeight: 1.1 },
    { text: `Generated ${dateText}`, color: '#DCDDFE', fontSize: 11, margin: [0, 12, 0, 0] },
    {
      margin: [0, 90, 0, 22],
      table: {
        widths: ['*', '*', '*'],
        body: [[stat(data.topics.length, 'topics'), stat(data.terms.length, 'key terms'), stat(scenarios.length, 'scenario questions')]],
      },
      layout: {
        fillColor: () => C.accentSoft,
        hLineWidth: () => 0,
        vLineWidth: (i, node) => (i === 0 || i === node.table.widths.length ? 0 : 3),
        vLineColor: () => '#FFFFFF',
      },
    },
    { text: 'How to use this reviewer', fontSize: 13, bold: true, color: C.ink, margin: [0, 0, 0, 8] },
    {
      ol: [
        'Read the Concept Summary to understand each topic.',
        'Study the Key Terms. Exams quote these definitions closely.',
        'Answer the Scenario Questions without peeking, then check the Answer Key at the end.',
      ],
      color: C.ink, fontSize: 10.5, lineHeight: 1.3, margin: [0, 0, 0, 14],
    },
    {
      text: [
        { text: 'Legend: ', bold: true },
        { text: ' highlighted words ', background: C.highlight, bold: true },
        { text: ' are the parts most likely to appear on the exam.' },
      ],
      fontSize: 10.5, color: C.ink,
    },
    fileNames.length
      ? { text: `Source${fileNames.length > 1 ? 's' : ''}: ${fileNames.join(', ')}`, fontSize: 9, color: C.muted, margin: [0, 26, 0, 0] }
      : null,
    data.models?.length ? { text: `Written by ${data.models.join(', ')} from your handout only.`, fontSize: 9, color: C.muted, margin: [0, 3, 0, 0] } : null,
  ].filter(Boolean);

  const content = [...cover];
  let sectionNo = 0;

  // ---------- Concept summary
  if (data.topics.length) {
    content.push(sectionHeader(++sectionNo, 'Concept Summary', 'The handout, topic by topic'));
    data.topics.forEach((t, i) => content.push(topicBlock(t, TOPIC_COLORS[i % TOPIC_COLORS.length])));
  }

  // ---------- Key terms
  content.push(sectionHeader(++sectionNo, 'Key Terms', `${data.terms.length} terms and their definitions from the handout`));
  const termRows = data.terms.map((t, i) => [
    { text: String(i + 1), color: C.muted, fontSize: 9, alignment: 'right', margin: [0, 2, 0, 0] },
    {
      stack: [
        { text: t.term, bold: true, color: colorFor(t.topic), fontSize: 11 },
        t.topic ? { text: t.topic, fontSize: 8, color: C.muted, margin: [0, 2, 0, 0] } : null,
      ].filter(Boolean),
    },
    {
      stack: [
        { text: highlight(t.definition), fontSize: 10.5, lineHeight: 1.2 },
        t.source ? { text: t.source, fontSize: 8, color: C.muted, italics: true, margin: [0, 3, 0, 0] } : null,
      ].filter(Boolean),
    },
  ]);
  content.push({
    table: {
      headerRows: 1,
      dontBreakRows: true,
      widths: [18, 130, '*'],
      body: [
        [
          { text: '#', bold: true, color: '#FFFFFF', fontSize: 9, alignment: 'right' },
          { text: 'TERM', bold: true, color: '#FFFFFF', fontSize: 9, characterSpacing: 1 },
          { text: 'DEFINITION', bold: true, color: '#FFFFFF', fontSize: 9, characterSpacing: 1 },
        ],
        ...termRows,
      ],
    },
    layout: {
      fillColor: (row) => (row === 0 ? C.accent : row % 2 === 0 ? C.zebra : null),
      hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
      hLineColor: () => C.line,
      vLineWidth: () => 0,
      paddingTop: () => 7,
      paddingBottom: () => 7,
      paddingLeft: () => 6,
      paddingRight: () => 6,
    },
  });

  // ---------- Scenario questions
  if (scenarios.length) {
    content.push(sectionHeader(++sectionNo, 'Scenario Questions', 'Pick the concept that applies. Answers are at the end.'));
    scenarios.forEach((q, i) => {
      content.push({
        unbreakable: true,
        margin: [0, 0, 0, 12],
        table: {
          widths: [30, '*'],
          body: [[
            {
              text: `Q${i + 1}`, bold: true, color: TOPIC_COLORS[i % TOPIC_COLORS.length],
              alignment: 'center', fontSize: 12, margin: [0, 2, 0, 0],
            },
            {
              stack: [
                { text: plain(q.scenario), fontSize: 10.5, lineHeight: 1.25, color: C.ink },
                { text: plain(q.question), bold: true, fontSize: 10.5, margin: [0, 6, 0, 6] },
                ...q.choices.map((c, j) => ({
                  columns: [
                    { text: LETTERS[j], width: 18, bold: true, color: TOPIC_COLORS[i % TOPIC_COLORS.length] },
                    { text: plain(c), width: '*' },
                  ],
                  fontSize: 10.5,
                  margin: [0, 0, 0, 3],
                })),
              ],
              margin: [10, 2, 4, 6],
            },
          ]],
        },
        layout: {
          fillColor: () => C.zebra,
          hLineWidth: () => 0,
          vLineWidth: (j) => (j === 0 ? 3 : 0),
          vLineColor: () => TOPIC_COLORS[i % TOPIC_COLORS.length],
          paddingTop: () => 10,
          paddingBottom: () => 6,
        },
      });
    });

    // ---------- Answer key
    content.push(sectionHeader(++sectionNo, 'Answer Key', 'Scenario questions, with the reason from the handout'));
    content.push({
      table: {
        headerRows: 1,
        dontBreakRows: true,
        widths: [26, 120, '*'],
        body: [
          [
            { text: 'Q', bold: true, color: '#FFFFFF', fontSize: 9 },
            { text: 'ANSWER', bold: true, color: '#FFFFFF', fontSize: 9, characterSpacing: 1 },
            { text: 'WHY', bold: true, color: '#FFFFFF', fontSize: 9, characterSpacing: 1 },
          ],
          ...scenarios.map((q, i) => [
            { text: String(i + 1), bold: true, color: C.muted, fontSize: 10 },
            { text: `${q.answer}. ${plain(q.choices[LETTERS.indexOf(q.answer)])}`, bold: true, color: C.ok, fontSize: 10.5 },
            { text: plain(q.explanation), fontSize: 10, color: C.ink, lineHeight: 1.2 },
          ]),
        ],
      },
      layout: {
        fillColor: (row) => (row === 0 ? C.ok : row % 2 === 0 ? C.okSoft : null),
        hLineWidth: (i, node) => (i === 0 || i === node.table.body.length ? 0 : 0.5),
        hLineColor: () => C.line,
        vLineWidth: () => 0,
        paddingTop: () => 6,
        paddingBottom: () => 6,
      },
    });
  }

  return {
    pageSize: 'A4',
    pageMargins: [48, 56, 48, 52],
    info: { title: `${title} - Reviewer` },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, color: C.ink },
    background: (page, size) => (page === 1
      ? { canvas: [{ type: 'rect', x: 0, y: 0, w: size.width, h: 300, color: C.accent }] }
      : null),
    header: (page) => (page === 1 ? null : {
      columns: [
        { text: title, fontSize: 8.5, color: C.muted, width: '*' },
        { text: 'EXAM REVIEWER', fontSize: 8, bold: true, color: C.accent, characterSpacing: 1.2, width: 'auto' },
      ],
      margin: [48, 24, 48, 0],
    }),
    footer: (page, pages) => (page === 1 ? null : {
      text: `${page} / ${pages}`, alignment: 'center', fontSize: 8.5, color: C.muted, margin: [0, 18, 0, 0],
    }),
    content,
  };
}
