export function attachPracticeFigures(message, figures) {
  if(!Array.isArray(figures)||message.querySelector('.practice-figures'))return;
  const valid=figures.filter(f=>/^\/api\/math-bank\/figures\/cnm_\d{3}_q\d+\/(question|[A-H])$/.test(f.url));
  if(!valid.length)return;
  const gallery=document.createElement('div');gallery.className='practice-figures';
  for(const f of valid){
    const figure=document.createElement('figure'),img=document.createElement('img'),caption=document.createElement('figcaption');
    figure.className=f.url.endsWith('/question')?'practice-question-figure':'practice-option-figure';
    img.src=f.url;img.alt=f.label||'题目配图';img.loading='lazy';caption.textContent=f.label||'题目配图';
    figure.append(img,caption);gallery.append(figure);
  }
  const content=message.querySelector('.message-content,.parent-message-text');
  if(content)content.after(gallery);else message.append(gallery);
}
