export async function collectWithLimit<T, R>(items: readonly T[], operation: (item:T)=>Promise<R>, limit=8): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let cursor = 0;
  const workers = Array.from({length:Math.min(Math.max(1,Math.floor(limit)),items.length)},async()=>{
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index]={status:"fulfilled",value:await operation(items[index])}; }
      catch(reason) { results[index]={status:"rejected",reason}; }
    }
  });
  await Promise.all(workers);
  return results;
}
