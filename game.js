export function outcome(a,b){
  if(a===b)return 'draw';
  return (a==='rock'&&b==='scissors')||(a==='scissors'&&b==='paper')||(a==='paper'&&b==='rock')?'win':'lose';
}
