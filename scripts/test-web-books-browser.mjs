// Run against a development server or a published site; no private book sources required.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
const output = process.env.BOOKS_QA_OUTPUT || 'tmp/books-browser-qa';
fs.mkdirSync(output, { recursive: true });
const base = (process.env.BOOKS_QA_URL || 'http://127.0.0.1:8911').replace(/\/$/, '');
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || undefined,headless:true,args:['--no-sandbox']});const errors=[],report=[];
for(const width of [1360,390]) {
 const p=await b.newPage({viewport:{width,height:900}});p.on('pageerror',e=>errors.push(e.message)); let popups=0;p.on('popup',()=>popups++);
 const loaded=async()=>{
   const number = new URLSearchParams(p.url().split('?')[1] || '').get('page') || '1';
   await p.locator('.book-directory small').filter({ hasText: new RegExp(`^${number} /`) }).waitFor();
   await p.locator('.book-reading-content[aria-busy=false]').waitFor();
   await p.locator('.book-block').first().waitFor(); await p.waitForTimeout(80);
 };
 const directory=async()=>{const wide=width>=1100;const surface=p.locator(wide?'.book-sidebar':'.sheet-book-contents');if(!wide||!await surface.isVisible())await p.locator('.book-directory').click();await surface.waitFor();return surface;};
 const closeDirectory=async()=>{if(width<1100){await p.keyboard.press('Escape');await p.locator('.sheet-book-contents').waitFor({state:'detached'});}};
 await p.goto(base+'/#/books');await p.locator('.books-card').last().waitFor();assert.equal(await p.locator('.books-card').count(),17);
 await p.getByLabel('搜索书名').fill('子平');assert.equal(await p.locator('.books-card').count(),1);
 await p.locator('.books-card a').click();await loaded();
 await p.locator('[data-book-mode="parallel"]').click();assert(await p.locator('.book-modern').first().isVisible());
 assert.equal(await p.locator('[data-book-mode="parallel"]').getAttribute('aria-pressed'),'true');
 await p.locator('.book-settings-open').click();assert.equal(await p.locator('.sheet-book-settings [aria-label="阅读模式"]').count(),0,'reading mode is available directly in the toolbar');
 await p.getByLabel('字号',{exact:true}).selectOption('24');await p.getByLabel('纸张',{exact:true}).selectOption('warm');await p.getByLabel('字体',{exact:true}).selectOption('sans');
 await p.getByRole('button',{name:'关闭',exact:true}).click();await p.locator('.overlay').waitFor({state:'detached'});
 assert.equal(await p.locator('.book-block p').first().evaluate(el=>getComputedStyle(el).fontSize),'24px');
 await p.locator('.book-page-next').click();await p.waitForURL('**page=2');await loaded();
 const anchors=p.locator('[data-reading-anchor]');const index=Math.min(4,await anchors.count()-1);
 await anchors.nth(index).evaluate(el=>window.scrollTo(0,scrollY+el.getBoundingClientRect().top+30-130));await p.waitForTimeout(400);
 const position=await p.evaluate(()=>JSON.parse(localStorage.getItem('xz-book-position:ziping-zhenquan')));assert.equal(position.number,2);
 const before=await p.evaluate(()=>scrollY);await p.reload();await loaded();await p.waitForTimeout(150);assert(Math.abs(await p.evaluate(()=>scrollY)-before)<10,'reload paragraph position');
 assert(await p.locator('.book-modern').first().isVisible());
 let contents=await directory();assert(Math.abs(await p.evaluate(()=>scrollY)-before)<2,'opening contents preserves paragraph position');await contents.getByLabel('搜索目录').fill('论用神');assert(await contents.locator('.book-contents-item').count()>0);
 await contents.getByLabel('搜索目录').fill('2');assert.equal(await contents.locator('.book-contents-item').count(),1);
 await contents.getByLabel('跳转阅读页码').fill('9999');await contents.getByRole('button',{name:'跳转',exact:true}).click();assert(await contents.isVisible());
 await contents.getByLabel('跳转阅读页码').fill('3');await contents.getByRole('button',{name:'跳转',exact:true}).click();await p.waitForURL('**page=3');await loaded();
 await p.goBack();await p.waitForURL('**page=2');await loaded();await p.waitForTimeout(150);{ const restored = await p.evaluate(()=>scrollY); assert(Math.abs(restored-before)<10, `back position: expected ${before}, got ${restored} at width ${width}`); }
 await p.goto(base+'/#/books/sanming-tonghui?page=7');await loaded();await p.locator('.book-figure img').evaluate(img=>img.decode());
 await p.locator('.book-figure-link').click();await p.locator('.book-image-stage img:not([hidden])').waitFor();await p.waitForTimeout(300);
 const readingY=await p.evaluate(()=>scrollY);const url=p.url();assert.equal(popups,0);assert.equal(p.url(),url);
 await p.getByRole('button',{name:'放大书影',exact:true}).click();assert.equal(await p.locator('.book-image-tools output').textContent(),'140%');
 await p.getByRole('button',{name:'放大书影',exact:true}).click();await p.getByRole('button',{name:'放大书影',exact:true}).click();
 const stage=p.locator('.book-image-stage');const rect=await stage.boundingBox();await p.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await p.mouse.down();await p.mouse.move(rect.x+rect.width/2+60,rect.y+rect.height/2+50);await p.mouse.up();
 assert(!/translate\(0px, 0px\)/.test(await p.locator('.book-image-stage img').getAttribute('style')),'drag pans image');
 await p.getByRole('button',{name:'适合屏幕',exact:true}).click();assert.equal(await p.locator('.book-image-tools output').textContent(),'100%');
 await stage.focus();await p.keyboard.press('+');assert.equal(await p.locator('.book-image-tools output').textContent(),'140%');
 await p.keyboard.press('Tab');await p.keyboard.press('Tab');assert(await p.evaluate(()=>document.activeElement.closest('[role=dialog]')!==null));
 await p.goBack();await p.locator('.overlay').waitFor({state:'detached'});assert.equal(p.url(),url);assert(Math.abs(await p.evaluate(()=>scrollY)-readingY)<2);assert(await p.locator('.book-figure-link').evaluate(el=>document.activeElement===el));
 await p.locator('.book-figure-open').click();await p.locator('.book-image-stage img:not([hidden])').waitFor();await p.waitForTimeout(300);await p.screenshot({path:join(output, 'image-'+width+'.png')});await p.keyboard.press('Escape');await p.locator('.overlay').waitFor({state:'detached'});
 assert.equal(popups,0);
 contents=await directory();await contents.getByLabel('搜索目录').fill('7');assert.equal(await contents.locator('.book-contents-item').count(),1);await contents.getByLabel('搜索目录').fill('不存在的目录');assert.equal(await contents.locator('.book-contents-item').count(),0);await closeDirectory();
 await p.goto(base+'/#/books/duanyi-tianji?page=156');await loaded();assert(await p.locator('.book-page-notice').isVisible());assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)));
 await p.goto(base+'/#/books');await p.locator('.books-card').last().waitFor();assert(await p.locator('.books-resume').isVisible());await p.getByLabel('搜索书名').fill('');assert.equal(await p.locator('.books-card').count(),17);
 assert.equal(await p.locator('.books-card').filter({has:p.getByRole('heading',{name:'滴天髓辑要',exact:true})}).getByRole('link').count(),0);
 await p.screenshot({path:join(output, 'library-'+width+'.png'),fullPage:true});
 report.push({width,books:17,settings:true,paragraph_resume:true,browser_back:true,directory_search:true,page_validation:true,image_zoom_pan:true,image_back_focus:true,new_tabs:popups,partial_notice:true,no_overflow:true});await p.close();
}
// All books: compare rendered original text with the public API, including folded tables/diagrams.
const p=await b.newPage({viewport:{width:390,height:844}});p.on('pageerror',e=>errors.push(e.message));const catalog = await (await p.request.get(base + '/api/books')).json();
const cases = catalog.books.filter(book => book.section_count > 0).flatMap(book => [...new Set([1, book.section_count])].map(number => ({ id: book.id, number }))); let verified=0;
for(const c of cases){await p.goto(base+'/#/books/'+c.id+'?page='+c.number);const response=await p.request.get(base+'/api/books/'+c.id+'/sections/'+c.number);const data=await response.json();if(data.blocks.length)await p.locator('.book-block').first().waitFor();else await p.locator('.book-section-header').waitFor();const texts=await p.locator('.book-original > p, .book-original > pre, .book-original > h3').allTextContents();assert.deepEqual(texts,data.blocks.map(b=>b.text),c.id+': original source preserved');assert.equal(await p.locator('.book-figure').count(),data.figures.length);assert(!(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)),c.id+' overflow');verified++;}
// A transient page error is recoverable without leaving the reader.
await p.route('**/api/books/huozhulin/sections/1',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({detail:'暂时不可用'})}));await p.goto(base+'/#/books/huozhulin?page=1');await p.getByText('这一页暂时没有打开',{exact:true}).waitFor();await p.unroute('**/api/books/huozhulin/sections/1');await p.getByRole('button',{name:/重试/}).click();await p.locator('.book-block').first().waitFor();
assert.deepEqual(errors,[]);await b.close();const result={passed:true,report,all_books:catalog.books.filter(book=>book.section_count>0).length,exact_original_pages:verified,retry:true,page_errors:errors};fs.writeFileSync(join(output, 'report.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));})().catch(e=>{console.error(e.stack);process.exit(1);});
