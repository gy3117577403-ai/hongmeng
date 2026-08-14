export const CAPABILITY_SHOWCASE_SITE_KEY = 'default';
export const CAPABILITY_SHOWCASE_SCHEMA_VERSION = 1 as const;

export type ShowcaseSpec = {
  id: string;
  label: string;
  value: string;
};

export type ShowcaseItem = {
  id: string;
  title: string;
  kicker: string;
  summary: string;
  image: string;
  imageAlt: string;
  tags: string[];
  specs: ShowcaseSpec[];
  visible: boolean;
};

export type ShowcaseCategory = {
  id: string;
  name: string;
  shortName: string;
  summary: string;
  coverage: string;
  image: string;
  imageAlt: string;
  visible: boolean;
  items: ShowcaseItem[];
};

export type ShowcaseQualityItem = {
  id: string;
  title: string;
  summary: string;
  evidenceLabel: string;
  image: string;
  imageAlt: string;
  visible: boolean;
};

export type CapabilityShowcaseContent = {
  schemaVersion: typeof CAPABILITY_SHOWCASE_SCHEMA_VERSION;
  sampleMode: boolean;
  identity: {
    brandName: string;
    brandTagline: string;
  };
  navigation: {
    overview: string;
    products: string;
    processes: string;
    equipment: string;
    quality: string;
    support: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    highlight: string;
    subtitle: string;
    image: string;
    imageAlt: string;
    primaryActionLabel: string;
    secondaryActionLabel: string;
  };
  products: {
    title: string;
    description: string;
    categories: ShowcaseCategory[];
  };
  processes: {
    title: string;
    description: string;
    categories: ShowcaseCategory[];
  };
  quality: {
    title: string;
    description: string;
    items: ShowcaseQualityItem[];
  };
  support: {
    title: string;
    description: string;
    contactName: string;
    contactPhone: string;
    contactEmail: string;
  };
  footer: {
    note: string;
  };
};

const ASSET = '/assets/capability-showcase';

function spec(id: string, label: string, value: string): ShowcaseSpec {
  return { id, label, value };
}

function item(
  id: string,
  title: string,
  kicker: string,
  summary: string,
  image: string,
  tags: string[],
  specs: ShowcaseSpec[],
): ShowcaseItem {
  return { id, title, kicker, summary, image, imageAlt: title, tags, specs, visible: true };
}

function category(
  id: string,
  name: string,
  shortName: string,
  summary: string,
  coverage: string,
  image: string,
  items: ShowcaseItem[],
): ShowcaseCategory {
  return { id, name, shortName, summary, coverage, image, imageAlt: name, visible: true, items };
}

const DEFAULT_CONTENT: CapabilityShowcaseContent = {
  schemaVersion: CAPABILITY_SHOWCASE_SCHEMA_VERSION,
  sampleMode: true,
  identity: {
    brandName: '线束制造能力展厅',
    brandTagline: '从材料处理到成品验证的制造能力展示',
  },
  navigation: {
    overview: '能力全景',
    products: '产品介绍',
    processes: '工艺流程',
    equipment: '设备与技术',
    quality: '质量管控',
    support: '合作支持',
  },
  hero: {
    eyebrow: '线束制造能力全景',
    title: '覆盖多类型线束与完整制造工艺',
    highlight: '0.1–120 mm²',
    subtitle: '从常规细线到高压大平方线缆，按产品、工艺与设备三个维度直观展示制造覆盖。',
    image: `${ASSET}/hero-factory.png`,
    imageAlt: '明亮整洁的线束生产车间与多条制造设备线',
    primaryActionLabel: '查看工艺流程',
    secondaryActionLabel: '浏览产品介绍',
  },
  products: {
    title: '产品介绍',
    description: '按线束应用类型组织，可持续补充真实产品照片、关键结构与适配范围。',
    categories: [
      category(
        'product-high-voltage',
        '高压线束',
        '高压线束',
        '面向大平方、高电压连接场景的线缆组件展示。',
        '示例分类',
        `${ASSET}/product-high-voltage-harness.png`,
        [item(
          'product-high-voltage-sample',
          '高压动力线束',
          '产品示例',
          '展示屏蔽、热缩、防护套管与大电流连接结构；正式参数以核实后的产品资料为准。',
          `${ASSET}/product-high-voltage-harness.png`,
          ['大平方', '屏蔽连接', '防护套管'],
          [spec('p-hv-1', '资料状态', '待替换真实照片'), spec('p-hv-2', '参数状态', '待业务核实')],
        )],
      ),
      category(
        'product-robot',
        '机器人线束',
        '机器人线束',
        '面向往复弯折、拖链和复杂分支布线场景的线束组件展示。',
        '示例分类',
        `${ASSET}/product-robot-harness.png`,
        [item(
          'product-robot-sample',
          '机器人柔性线束',
          '产品示例',
          '展示多分支、耐弯保护与工业连接器组合；正式寿命与选材数据发布前需核实。',
          `${ASSET}/product-robot-harness.png`,
          ['柔性布线', '拖链应用', '复杂分支'],
          [spec('p-rb-1', '资料状态', '待替换真实照片'), spec('p-rb-2', '参数状态', '待业务核实')],
        )],
      ),
      category(
        'product-industrial',
        '工业设备线束',
        '设备线束',
        '用于设备内部连接、控制柜与传感器布线的产品分类示例。',
        '可编辑分类',
        `${ASSET}/hero-factory.png`,
        [item(
          'product-industrial-sample',
          '工业控制线束',
          '产品示例',
          '用于演示分类与图文结构，发布前请替换为企业真实产品。',
          `${ASSET}/product-robot-harness.png`,
          ['设备连接', '控制信号'],
          [spec('p-in-1', '资料状态', '待补充')],
        )],
      ),
    ],
  },
  processes: {
    title: '从线材到成品的工艺覆盖',
    description: '工艺分类、设备条目、图片与参数均可在维护端增删、改名和排序。',
    categories: [
      category('process-cutting-standard', '常规线材裁切', '常规裁线', '细径与常规线材的定长、裁切及剥皮能力。', '0.1–10 mm²', `${ASSET}/equipment-cutting-standard.png`, [
        item('equipment-cutting-standard', '全自动裁线剥线设备', '全自动', '用于常规线材定长、裁切与剥皮的设备能力展示。', `${ASSET}/equipment-cutting-standard.png`, ['定长', '裁切', '剥皮'], [spec('ecs-1', '覆盖范围', '0.1–10 mm²'), spec('ecs-2', '设备型号', '待录入真实信息')]),
      ]),
      category('process-cutting-hv', '高压大平方线裁切', '高压裁线', '粗径高压线缆的送料、定长、裁切与端部处理。', '10–120 mm²', `${ASSET}/equipment-cutting-high-voltage.png`, [
        item('equipment-cutting-hv', '高压线裁切剥皮设备', '专用设备', '用于高压大平方线缆的裁切与端部预处理能力展示。', `${ASSET}/equipment-cutting-high-voltage.png`, ['大平方', '高压线缆', '端部处理'], [spec('ech-1', '覆盖范围', '10–120 mm²'), spec('ech-2', '设备型号', '待录入真实信息')]),
      ]),
      category('process-tube', '波纹管与套管裁切', '套管裁切', '波纹管、保护套管的定长与无毛刺裁切。', '多种管径', `${ASSET}/equipment-corrugated-tube.png`, [
        item('equipment-corrugated-tube', '波纹管自动裁切设备', '自动化', '展示保护套管的送料、测长、裁切与收料能力。', `${ASSET}/equipment-corrugated-tube.png`, ['波纹管', '定长裁切', '保护套管'], [spec('ect-1', '管径范围', '待录入真实信息')]),
      ]),
      category('process-tinning', '剥线与沾锡', '剥线沾锡', '线端剥皮、助焊、沾锡及烟气处理工序。', '工艺参数可配置', `${ASSET}/equipment-tinning.png`, [
        item('equipment-tinning', '自动剥线沾锡工作站', '自动化', '用于演示剥线、沾锡与过程防护能力。', `${ASSET}/equipment-tinning.png`, ['剥线', '沾锡', '烟气净化'], [spec('eti-1', '适用线径', '待录入真实信息')]),
      ]),
      category('process-crimp-auto', '全自动压接', '全自动压接', '送料、切剥、端子压接与过程检测的组合工序。', '全自动', `${ASSET}/equipment-crimping-automatic.png`, [
        item('equipment-crimping-auto', '全自动端子压接设备', '全自动', '展示端子带送料、压接与在线检测能力。', `${ASSET}/equipment-crimping-automatic.png`, ['端子压接', '在线检测', '连续加工'], [spec('eca-1', '压接范围', '待录入真实信息')]),
      ]),
      category('process-crimp-semi', '半自动压接', '半自动压接', '适配多品种、小批量与专用端子的柔性压接工位。', '半自动', `${ASSET}/equipment-crimping-semi-auto.png`, [
        item('equipment-crimping-semi', '半自动端子压接工作站', '半自动', '展示模具切换、端子送料与安全防护配置。', `${ASSET}/equipment-crimping-semi-auto.png`, ['柔性换型', '专用端子', '安全防护'], [spec('ecs-3', '适用端子', '待录入真实信息')]),
      ]),
      category('process-assembly', '穿管、布线与装配', '装配', '多分支线束的穿管、分支定位、绑扎与连接器装配。', '人工与工装协同', `${ASSET}/product-robot-harness.png`, [
        item('equipment-assembly', '线束装配工位', '柔性工位', '用于展示穿管、布线、分支定位和连接器装配。', `${ASSET}/product-robot-harness.png`, ['穿管', '分支定位', '连接器装配'], [spec('eas-1', '工装信息', '待上传真实工位照片')]),
      ]),
      category('process-heat-shrink', '热缩与定型', '热缩', '热缩管定位、恒温加热与成品定型工序。', '温控工艺', `${ASSET}/equipment-heat-shrink.png`, [
        item('equipment-heat-shrink', '连续式线束热缩炉', '专用设备', '展示恒温通道、输送与热缩过程控制。', `${ASSET}/equipment-heat-shrink.png`, ['热缩炉', '恒温', '连续输送'], [spec('ehs-1', '温度范围', '待录入真实信息')]),
      ]),
      category('process-test', '导通、耐压与绝缘测试', '电气测试', '成品线束的回路、电气安全与连接一致性验证。', '检验项目可配置', `${ASSET}/equipment-electrical-test.png`, [
        item('equipment-electrical-test', '线束综合电气测试台', '检测设备', '展示多回路导通、耐压与绝缘测试能力。', `${ASSET}/equipment-electrical-test.png`, ['导通', '耐压', '绝缘'], [spec('eet-1', '测试项目', '待按真实能力核实')]),
      ]),
      category('process-inspection', '外观、尺寸与标识检验', '外观检验', '对成品外观、尺寸、分支位置和标识完整性进行确认。', '检验标准可配置', `${ASSET}/equipment-electrical-test.png`, [
        item('equipment-visual-inspection', '成品检验工位', '检验工位', '用于展示外观、尺寸与标识确认，发布前替换真实照片。', `${ASSET}/equipment-electrical-test.png`, ['外观', '尺寸', '标识'], [spec('evi-1', '检验依据', '待录入')]),
      ]),
      category('process-packaging', '包装与出货', '包装出货', '按产品防护与交付要求完成盘绕、包装、标识和出货确认。', '交付要求可配置', `${ASSET}/hero-factory.png`, [
        item('equipment-packaging', '包装与出货工位', '交付工位', '用于演示成品防护、包装与出货确认流程。', `${ASSET}/hero-factory.png`, ['包装', '防护', '出货确认'], [spec('epk-1', '包装标准', '待录入')]),
      ]),
    ],
  },
  quality: {
    title: '质量管控',
    description: '以可核实的检验项目、设备与记录作为对外展示依据，不自动生成未经确认的能力承诺。',
    items: [
      { id: 'quality-incoming', title: '来料与首件确认', summary: '展示材料、端子、连接器和首件的确认节点。', evidenceLabel: '待补充真实依据', image: `${ASSET}/equipment-cutting-standard.png`, imageAlt: '线材处理设备', visible: true },
      { id: 'quality-process', title: '过程参数与压接确认', summary: '展示关键参数、压接结果和过程巡检的管理方式。', evidenceLabel: '待补充真实依据', image: `${ASSET}/equipment-crimping-automatic.png`, imageAlt: '端子压接设备', visible: true },
      { id: 'quality-electrical', title: '成品电气测试', summary: '用于展示经企业核实后允许对外说明的导通、耐压、绝缘等测试项目。', evidenceLabel: '待补充真实依据', image: `${ASSET}/equipment-electrical-test.png`, imageAlt: '线束综合测试设备', visible: true },
    ],
  },
  support: {
    title: '需要匹配具体线束方案？',
    description: '可基于线径范围、端子与连接器、工艺要求和交付资料进一步确认制造覆盖。',
    contactName: '',
    contactPhone: '',
    contactEmail: '',
  },
  footer: {
    note: '本页为只读能力展示；演示模式下的图片与参数需在正式对外发布前替换并核实。',
  },
};

export function defaultCapabilityShowcaseContent(): CapabilityShowcaseContent {
  return JSON.parse(JSON.stringify(DEFAULT_CONTENT)) as CapabilityShowcaseContent;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内容结构无效');
  return value as Record<string, unknown>;
}

function shortText(value: unknown, field: string, max: number, allowEmpty = false): string {
  const text = String(value ?? '').trim();
  if (!allowEmpty && !text) throw new Error(`${field}不能为空`);
  if (text.length > max) throw new Error(`${field}不能超过${max}个字符`);
  return text;
}

function validId(value: unknown, field: string): string {
  const id = shortText(value, field, 80);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) throw new Error(`${field}格式无效`);
  return id;
}

export function isCapabilityShowcaseImageRef(value: string): boolean {
  return value === ''
    || /^\/assets\/capability-showcase\/[A-Za-z0-9._-]+$/.test(value)
    || /^media:[A-Za-z0-9_-]{8,120}$/.test(value);
}

function imageRef(value: unknown, field: string): string {
  const ref = shortText(value, field, 220, true);
  if (!isCapabilityShowcaseImageRef(ref)) throw new Error(`${field}不是允许的图片引用`);
  return ref;
}

function stringArray(value: unknown, field: string, limit = 12): string[] {
  if (!Array.isArray(value)) throw new Error(`${field}结构无效`);
  if (value.length > limit) throw new Error(`${field}数量不能超过${limit}`);
  return value.map((entry, index) => shortText(entry, `${field}${index + 1}`, 36)).filter(Boolean);
}

function specArray(value: unknown, field: string): ShowcaseSpec[] {
  if (!Array.isArray(value)) throw new Error(`${field}结构无效`);
  if (value.length > 16) throw new Error(`${field}数量不能超过16`);
  return value.map((entry, index) => {
    const row = plainObject(entry);
    return {
      id: validId(row.id, `${field}${index + 1}编号`),
      label: shortText(row.label, `${field}${index + 1}名称`, 40),
      value: shortText(row.value, `${field}${index + 1}内容`, 120),
    };
  });
}

function normalizeItem(value: unknown, field: string): ShowcaseItem {
  const row = plainObject(value);
  return {
    id: validId(row.id, `${field}编号`),
    title: shortText(row.title, `${field}标题`, 80),
    kicker: shortText(row.kicker, `${field}类型`, 40, true),
    summary: shortText(row.summary, `${field}说明`, 500, true),
    image: imageRef(row.image, `${field}图片`),
    imageAlt: shortText(row.imageAlt, `${field}图片说明`, 120, true),
    tags: stringArray(row.tags, `${field}标签`),
    specs: specArray(row.specs, `${field}参数`),
    visible: row.visible !== false,
  };
}

function normalizeCategory(value: unknown, field: string): ShowcaseCategory {
  const row = plainObject(value);
  if (!Array.isArray(row.items) || row.items.length > 80) throw new Error(`${field}条目数量不能超过80`);
  return {
    id: validId(row.id, `${field}编号`),
    name: shortText(row.name, `${field}名称`, 80),
    shortName: shortText(row.shortName, `${field}短名称`, 24),
    summary: shortText(row.summary, `${field}说明`, 500, true),
    coverage: shortText(row.coverage, `${field}覆盖范围`, 80, true),
    image: imageRef(row.image, `${field}图片`),
    imageAlt: shortText(row.imageAlt, `${field}图片说明`, 120, true),
    visible: row.visible !== false,
    items: row.items.map((entry, index) => normalizeItem(entry, `${field}条目${index + 1}`)),
  };
}

function normalizeCategories(value: unknown, field: string, limit: number): ShowcaseCategory[] {
  if (!Array.isArray(value) || value.length > limit) throw new Error(`${field}数量不能超过${limit}`);
  return value.map((entry, index) => normalizeCategory(entry, `${field}${index + 1}`));
}

function assertUniqueIds(content: CapabilityShowcaseContent) {
  const ids = new Set<string>();
  const claim = (id: string) => {
    if (ids.has(id)) throw new Error(`编号重复：${id}`);
    ids.add(id);
  };
  for (const category of [...content.products.categories, ...content.processes.categories]) {
    claim(category.id);
    for (const entry of category.items) {
      claim(entry.id);
      entry.specs.forEach(specification => claim(specification.id));
    }
  }
  content.quality.items.forEach(entry => claim(entry.id));
}

export function normalizeCapabilityShowcaseContent(value: unknown): CapabilityShowcaseContent {
  const root = plainObject(value);
  if (Number(root.schemaVersion) !== CAPABILITY_SHOWCASE_SCHEMA_VERSION) throw new Error('内容版本不受支持');
  const identity = plainObject(root.identity);
  const navigation = plainObject(root.navigation);
  const hero = plainObject(root.hero);
  const products = plainObject(root.products);
  const processes = plainObject(root.processes);
  const quality = plainObject(root.quality);
  const support = plainObject(root.support);
  const footer = plainObject(root.footer);
  if (!Array.isArray(quality.items) || quality.items.length > 30) throw new Error('质量项目数量不能超过30');

  const content: CapabilityShowcaseContent = {
    schemaVersion: CAPABILITY_SHOWCASE_SCHEMA_VERSION,
    sampleMode: root.sampleMode !== false,
    identity: {
      brandName: shortText(identity.brandName, '站点名称', 60),
      brandTagline: shortText(identity.brandTagline, '站点副标题', 140, true),
    },
    navigation: {
      overview: shortText(navigation.overview, '能力全景菜单', 16),
      products: shortText(navigation.products, '产品介绍菜单', 16),
      processes: shortText(navigation.processes, '工艺流程菜单', 16),
      equipment: shortText(navigation.equipment, '设备技术菜单', 16),
      quality: shortText(navigation.quality, '质量管控菜单', 16),
      support: shortText(navigation.support, '合作支持菜单', 16),
    },
    hero: {
      eyebrow: shortText(hero.eyebrow, '首屏眉题', 50),
      title: shortText(hero.title, '首屏标题', 100),
      highlight: shortText(hero.highlight, '首屏重点数字', 40),
      subtitle: shortText(hero.subtitle, '首屏说明', 400),
      image: imageRef(hero.image, '首屏图片'),
      imageAlt: shortText(hero.imageAlt, '首屏图片说明', 120, true),
      primaryActionLabel: shortText(hero.primaryActionLabel, '首屏主按钮', 20),
      secondaryActionLabel: shortText(hero.secondaryActionLabel, '首屏次按钮', 20),
    },
    products: {
      title: shortText(products.title, '产品区标题', 80),
      description: shortText(products.description, '产品区说明', 300, true),
      categories: normalizeCategories(products.categories, '产品分类', 40),
    },
    processes: {
      title: shortText(processes.title, '工艺区标题', 80),
      description: shortText(processes.description, '工艺区说明', 300, true),
      categories: normalizeCategories(processes.categories, '工艺分类', 80),
    },
    quality: {
      title: shortText(quality.title, '质量区标题', 80),
      description: shortText(quality.description, '质量区说明', 300, true),
      items: quality.items.map((entry, index) => {
        const row = plainObject(entry);
        return {
          id: validId(row.id, `质量项目${index + 1}编号`),
          title: shortText(row.title, `质量项目${index + 1}标题`, 80),
          summary: shortText(row.summary, `质量项目${index + 1}说明`, 400, true),
          evidenceLabel: shortText(row.evidenceLabel, `质量项目${index + 1}依据`, 80, true),
          image: imageRef(row.image, `质量项目${index + 1}图片`),
          imageAlt: shortText(row.imageAlt, `质量项目${index + 1}图片说明`, 120, true),
          visible: row.visible !== false,
        };
      }),
    },
    support: {
      title: shortText(support.title, '合作支持标题', 100),
      description: shortText(support.description, '合作支持说明', 400, true),
      contactName: shortText(support.contactName, '联系人', 60, true),
      contactPhone: shortText(support.contactPhone, '联系电话', 40, true),
      contactEmail: shortText(support.contactEmail, '联系邮箱', 120, true),
    },
    footer: {
      note: shortText(footer.note, '页脚说明', 300, true),
    },
  };
  assertUniqueIds(content);
  return content;
}

export function referencedCapabilityShowcaseMediaIds(content: CapabilityShowcaseContent): Set<string> {
  const ids = new Set<string>();
  const inspect = (ref: string) => {
    if (ref.startsWith('media:')) ids.add(ref.slice('media:'.length));
  };
  inspect(content.hero.image);
  for (const category of [...content.products.categories, ...content.processes.categories]) {
    inspect(category.image);
    category.items.forEach(entry => inspect(entry.image));
  }
  content.quality.items.forEach(entry => inspect(entry.image));
  return ids;
}

export function capabilityShowcaseImageUrl(
  ref: string,
  mediaUrl: (id: string) => string,
): string {
  return ref.startsWith('media:') ? mediaUrl(ref.slice('media:'.length)) : ref;
}

export function isShowcaseUploadMime(mimeType: string): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(mimeType.toLowerCase());
}
