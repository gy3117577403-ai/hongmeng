'use client';

import {
  ArrowRight,
  Check,
  ChevronDown,
  Factory,
  Mail,
  Menu,
  Phone,
  ShieldCheck,
  X,
} from 'lucide-react';
import Image from 'next/image';
import { useMemo, useState } from 'react';
import type {
  CapabilityShowcaseContent,
  ShowcaseCategory,
  ShowcaseItem,
} from '@/lib/capability-showcase';
import styles from './CapabilityShowcaseView.module.css';

type CapabilityShowcaseViewProps = {
  content: CapabilityShowcaseContent;
  mediaMode: 'draft' | 'share';
  shareToken?: string;
  publishedAt?: string | null;
  preview?: boolean;
};

function imageUrl(ref: string, mode: CapabilityShowcaseViewProps['mediaMode'], token?: string) {
  if (!ref.startsWith('media:')) return ref;
  const mediaId = ref.slice('media:'.length);
  return mode === 'share' && token
    ? `/api/capability-showcase/share/${encodeURIComponent(token)}/media/${encodeURIComponent(mediaId)}`
    : `/api/capability-showcase/media/${encodeURIComponent(mediaId)}/content`;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function ShowcaseImage({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return <Image src={src} alt={alt} width={1600} height={1000} priority={priority} unoptimized={src.startsWith('/api/')} sizes="(max-width: 640px) 100vw, (max-width: 1000px) 60vw, 40vw" />;
}

function visibleCategories(categories: ShowcaseCategory[]) {
  return categories.filter(category => category.visible);
}

function visibleItems(category: ShowcaseCategory) {
  return category.items.filter(entry => entry.visible);
}

function ProductCard({
  item,
  mediaMode,
  shareToken,
}: {
  item: ShowcaseItem;
  mediaMode: CapabilityShowcaseViewProps['mediaMode'];
  shareToken?: string;
}) {
  return (
    <article className={styles.productCard}>
      <div className={styles.productImageWrap}>
        {item.image ? <ShowcaseImage src={imageUrl(item.image, mediaMode, shareToken)} alt={item.imageAlt || item.title} /> : <div className={styles.imageFallback}><Factory /></div>}
        {item.kicker && <span className={styles.imageBadge}>{item.kicker}</span>}
      </div>
      <div className={styles.productBody}>
        <h3>{item.title}</h3>
        <p>{item.summary}</p>
        {!!item.tags.length && <div className={styles.tags}>{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>}
        {!!item.specs.length && <dl className={styles.specList}>{item.specs.map(entry => <div key={entry.id}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>)}</dl>}
      </div>
    </article>
  );
}

export function CapabilityShowcaseView({
  content,
  mediaMode,
  shareToken,
  publishedAt,
  preview = false,
}: CapabilityShowcaseViewProps) {
  const productCategories = useMemo(() => visibleCategories(content.products.categories), [content.products.categories]);
  const processCategories = useMemo(() => visibleCategories(content.processes.categories), [content.processes.categories]);
  const [productCategoryId, setProductCategoryId] = useState(productCategories[0]?.id || '');
  const [processCategoryId, setProcessCategoryId] = useState(processCategories[0]?.id || '');
  const [equipmentFilter, setEquipmentFilter] = useState('全部');
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeProductCategory = productCategories.find(entry => entry.id === productCategoryId) || productCategories[0];
  const activeProcessCategory = processCategories.find(entry => entry.id === processCategoryId) || processCategories[0];
  const allEquipment = processCategories.flatMap(category => visibleItems(category).map(entry => ({ ...entry, processName: category.shortName || category.name })));
  const equipmentFilters = ['全部', ...Array.from(new Set(allEquipment.map(entry => entry.kicker).filter(Boolean)))];
  const filteredEquipment = equipmentFilter === '全部' ? allEquipment : allEquipment.filter(entry => entry.kicker === equipmentFilter);
  const publicDate = publishedAt ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Shanghai' }).format(new Date(publishedAt)) : '';

  const navItems = [
    [content.navigation.overview, 'overview'],
    [content.navigation.products, 'products'],
    [content.navigation.processes, 'processes'],
    [content.navigation.equipment, 'equipment'],
    [content.navigation.quality, 'quality'],
    [content.navigation.support, 'support'],
  ] as const;

  function navigate(section: string) {
    setMobileOpen(false);
    scrollToSection(section);
  }

  return (
    <main className={`${styles.showcase} ${preview ? styles.preview : ''}`}>
      {content.sampleMode && <div className={styles.sampleRibbon}>演示资料 · 图片与参数需核实后再正式对外使用</div>}
      <header className={styles.header}>
        <button type="button" className={styles.brand} onClick={() => navigate('overview')} aria-label="返回能力全景">
          <span className={styles.brandMark}><Factory /></span>
          <span><strong>{content.identity.brandName}</strong><small>{content.identity.brandTagline}</small></span>
        </button>
        <nav className={`${styles.nav} ${mobileOpen ? styles.navOpen : ''}`} aria-label="能力展示导航">
          {navItems.map(([label, id]) => <button type="button" key={id} onClick={() => navigate(id)}>{label}</button>)}
        </nav>
        <div className={styles.headerActions}>
          {publicDate && <span className={styles.publishDate}>更新于 {publicDate}</span>}
          <button type="button" className={styles.contactButton} onClick={() => navigate('support')}>获取能力资料 <ArrowRight /></button>
          <button type="button" className={styles.mobileToggle} onClick={() => setMobileOpen(open => !open)} aria-label={mobileOpen ? '关闭导航' : '打开导航'}>{mobileOpen ? <X /> : <Menu />}</button>
        </div>
      </header>

      <section className={styles.hero} id="overview">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>{content.hero.eyebrow}</span>
          <h1>{content.hero.title}</h1>
          <strong className={styles.heroHighlight}>{content.hero.highlight}</strong>
          <p>{content.hero.subtitle}</p>
          <div className={styles.heroButtons}>
            <button type="button" className={styles.primaryButton} onClick={() => navigate('processes')}>{content.hero.primaryActionLabel}<ArrowRight /></button>
            <button type="button" className={styles.secondaryButton} onClick={() => navigate('products')}>{content.hero.secondaryActionLabel}</button>
          </div>
          <dl className={styles.heroStats}>
            <div><dt>工艺分类</dt><dd>{processCategories.length}<small> 类</small></dd></div>
            <div><dt>设备与工位</dt><dd>{allEquipment.length}<small> 项</small></dd></div>
            <div><dt>内容状态</dt><dd>{content.sampleMode ? '演示' : '已核实'}</dd></div>
          </dl>
        </div>
        <div className={styles.heroVisual}>
          {content.hero.image ? <ShowcaseImage src={imageUrl(content.hero.image, mediaMode, shareToken)} alt={content.hero.imageAlt || content.hero.title} priority /> : <div className={styles.imageFallback}><Factory /></div>}
          <div className={styles.heroVisualLabel}><span>制造覆盖</span><strong>{content.hero.highlight}</strong><small>按已录入资料展示</small></div>
        </div>
      </section>

      <section className={styles.section} id="products">
        <div className={styles.sectionHeading}>
          <div><span>PRODUCT PORTFOLIO</span><h2>{content.products.title}</h2><p>{content.products.description}</p></div>
          <strong>{productCategories.length} 个产品分类</strong>
        </div>
        {productCategories.length ? <>
          <div className={styles.pillTabs} role="tablist" aria-label="产品分类">
            {productCategories.map(category => <button type="button" role="tab" aria-selected={activeProductCategory?.id === category.id} className={activeProductCategory?.id === category.id ? styles.activePill : ''} key={category.id} onClick={() => setProductCategoryId(category.id)}>{category.shortName || category.name}</button>)}
          </div>
          {activeProductCategory && <div className={styles.categoryIntro}>
            <div><span>{activeProductCategory.coverage}</span><h3>{activeProductCategory.name}</h3><p>{activeProductCategory.summary}</p></div>
            <div className={styles.productGrid}>{visibleItems(activeProductCategory).map(entry => <ProductCard key={entry.id} item={entry} mediaMode={mediaMode} shareToken={shareToken} />)}</div>
          </div>}
        </> : <div className={styles.empty}>暂未发布产品分类</div>}
      </section>

      <section className={`${styles.section} ${styles.processSection}`} id="processes">
        <div className={styles.sectionHeading}>
          <div><span>PROCESS CAPABILITY</span><h2>{content.processes.title}</h2><p>{content.processes.description}</p></div>
        </div>
        {processCategories.length ? <>
          <div className={styles.processRail} role="tablist" aria-label="工艺流程">
            {processCategories.map((category, index) => <button type="button" role="tab" aria-selected={activeProcessCategory?.id === category.id} className={activeProcessCategory?.id === category.id ? styles.activeProcess : ''} key={category.id} onClick={() => setProcessCategoryId(category.id)}><span>{String(index + 1).padStart(2, '0')}</span><strong>{category.shortName || category.name}</strong><small>{category.coverage}</small></button>)}
          </div>
          {activeProcessCategory && <div className={styles.processDetail}>
            <div className={styles.processCopy}>
              <span>当前工艺</span>
              <h3>{activeProcessCategory.name}</h3>
              <strong>{activeProcessCategory.coverage}</strong>
              <p>{activeProcessCategory.summary}</p>
              <div className={styles.checkList}>{visibleItems(activeProcessCategory).slice(0, 4).map(entry => <span key={entry.id}><Check />{entry.title}</span>)}</div>
            </div>
            <div className={styles.processEquipment}>
              {visibleItems(activeProcessCategory).map(entry => <ProductCard key={entry.id} item={entry} mediaMode={mediaMode} shareToken={shareToken} />)}
            </div>
          </div>}
        </> : <div className={styles.empty}>暂未发布工艺分类</div>}
      </section>

      <section className={styles.section} id="equipment">
        <div className={styles.sectionHeading}>
          <div><span>EQUIPMENT & TECHNOLOGY</span><h2>{content.navigation.equipment}</h2><p>设备条目从工艺分类自动汇总，既能按工艺查看，也能按自动化类型筛选。</p></div>
          <strong>{allEquipment.length} 项设备与工位</strong>
        </div>
        <div className={styles.equipmentToolbar}>
          <div className={styles.pillTabs}>{equipmentFilters.map(filter => <button type="button" className={equipmentFilter === filter ? styles.activePill : ''} key={filter} onClick={() => setEquipmentFilter(filter)}>{filter}</button>)}</div>
        </div>
        <div className={styles.equipmentGrid}>
          {filteredEquipment.map(entry => <article key={entry.id} className={styles.equipmentCard}>
            <div>{entry.image ? <ShowcaseImage src={imageUrl(entry.image, mediaMode, shareToken)} alt={entry.imageAlt || entry.title} /> : <div className={styles.imageFallback}><Factory /></div>}<span>{entry.processName}</span></div>
            <section><small>{entry.kicker}</small><h3>{entry.title}</h3><p>{entry.summary}</p>{entry.specs[0] && <strong>{entry.specs[0].label} · {entry.specs[0].value}</strong>}</section>
          </article>)}
        </div>
      </section>

      <section className={`${styles.section} ${styles.qualitySection}`} id="quality">
        <div className={styles.sectionHeading}>
          <div><span>QUALITY CONTROL</span><h2>{content.quality.title}</h2><p>{content.quality.description}</p></div>
        </div>
        <div className={styles.qualityGrid}>
          {content.quality.items.filter(entry => entry.visible).map((entry, index) => <article key={entry.id}>
            <div>{entry.image ? <ShowcaseImage src={imageUrl(entry.image, mediaMode, shareToken)} alt={entry.imageAlt || entry.title} /> : <div className={styles.imageFallback}><ShieldCheck /></div>}<span>{String(index + 1).padStart(2, '0')}</span></div>
            <section><ShieldCheck /><h3>{entry.title}</h3><p>{entry.summary}</p><strong>{entry.evidenceLabel}</strong></section>
          </article>)}
        </div>
      </section>

      <section className={styles.support} id="support">
        <div><span>COOPERATION SUPPORT</span><h2>{content.support.title}</h2><p>{content.support.description}</p></div>
        <div className={styles.contactPanel}>
          {content.support.contactName && <strong>{content.support.contactName}</strong>}
          {content.support.contactPhone && <a href={`tel:${content.support.contactPhone.replace(/\s/g, '')}`}><Phone />{content.support.contactPhone}</a>}
          {content.support.contactEmail && <a href={`mailto:${content.support.contactEmail}`}><Mail />{content.support.contactEmail}</a>}
          {!content.support.contactName && !content.support.contactPhone && !content.support.contactEmail && <span>请在维护端补充正式联系方式</span>}
        </div>
      </section>

      <footer className={styles.footer}>
        <div><span className={styles.brandMark}><Factory /></span><strong>{content.identity.brandName}</strong></div>
        <p>{content.footer.note}</p>
        <button type="button" onClick={() => navigate('overview')}>返回顶部 <ChevronDown /></button>
      </footer>
    </main>
  );
}
