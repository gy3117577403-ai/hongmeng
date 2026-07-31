const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map((image, index) => {
    const label = image.alt?.trim() || `第 ${index + 1} 张图片`;
    if (image.complete) {
      if (image.naturalWidth > 0) return Promise.resolve();
      return Promise.reject(new Error(`${label}加载失败，已停止发布`));
    }
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        window.clearTimeout(timeout);
        image.removeEventListener('load', handleLoad);
        image.removeEventListener('error', handleError);
      };
      const handleLoad = () => {
        cleanup();
        if (image.naturalWidth > 0) resolve();
        else reject(new Error(`${label}加载失败，已停止发布`));
      };
      const handleError = () => {
        cleanup();
        reject(new Error(`${label}加载失败，已停止发布`));
      };
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error(`${label}加载超时，已停止发布`));
      }, 15_000);
      image.addEventListener('load', handleLoad, { once: true });
      image.addEventListener('error', handleError, { once: true });
    });
  }));
}

export async function createSopPdfBlob(root: HTMLElement): Promise<Blob> {
  await document.fonts?.ready;
  await waitForImages(root);

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  const pages = Array.from(root.querySelectorAll<HTMLElement>('[data-sop-export-page]'));
  if (!pages.length) throw new Error('没有可导出的 SOP 页面');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  for (let index = 0; index < pages.length; index += 1) {
    const canvas = await html2canvas(pages[index], {
      backgroundColor: '#ffffff',
      scale: Math.min(2, Math.max(1.35, window.devicePixelRatio || 1)),
      useCORS: true,
      allowTaint: false,
      logging: false,
      imageTimeout: 15000,
      windowWidth: pages[index].scrollWidth,
      windowHeight: pages[index].scrollHeight,
    });
    if (index > 0) pdf.addPage('a4', 'portrait');
    const ratio = Math.min(A4_WIDTH_MM / canvas.width, A4_HEIGHT_MM / canvas.height);
    const width = canvas.width * ratio;
    const height = canvas.height * ratio;
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', (A4_WIDTH_MM - width) / 2, 0, width, height, undefined, 'FAST');
  }
  return pdf.output('blob');
}
