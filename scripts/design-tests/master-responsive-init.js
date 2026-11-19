(function(){
  try{ localStorage.setItem('fwd.uiMode','detail'); }catch(e){}
  const ME='s@example.com';
  const L='株式会社グローバルロジスティクスインターナショナルフォワーディングサービス東日本支店ホールディングス';
  const db={master_votes:[],synonym_groups:[],master_details:[],alias_rules:[],master_requests:[],stats_exclusions:[]};
  const vote=(f,v)=>db.master_votes.push({field:f,value:v,voter_email:ME});
  const det=(f,v,d)=>db.master_details.push({field:f,value:v,details:d});
  const tags=['荷主','大口','要注意','新規','航空専門','危険品','冷凍','中国向け','東南アジア','欧州','LCL中心','代金回収注意'];
  const deals=['荷主（直接）','同業者（フォワーダー・代理店）','海外代理店','乙仲','その他'];
  for(let i=1;i<=60;i++){
    const nm=(i%7===0?L+i:'お客様'+i+'商事株式会社');
    vote('customer',nm);
    const d={dealType:deals[i%5],tags:tags.slice(0,(i%12)+1),furigana:'おきゃくさま'+i,location:'東京都港区芝浦1-2-3 '+nm,
      contacts:[{name:'山田太郎'+i,dept:'国際物流部第二課',title:'課長',tel:'03-1234-56'+i,email:'yamada'+i+'@example.com',location:'大阪'},{name:'鈴木花子',dept:'営業',title:'',tel:'',email:''}],
      website:'https://example.com/'+i, memo:'メモ'.repeat(30)};
    if(i%9===0) d.contractType='業務委託';
    if(i>=10&&i<=24&&i%3!==0) d.via='お客様'+(i%3===1?5:6)+'商事株式会社';
    if(i%4===0) d.referrer='お客様1商事株式会社';
    det('customer',nm,d);
    if(i%5===0) db.synonym_groups.push({id:'cg'+i,field:'customer',canonical:nm,aliases:['別名'+i+'A','別名'+i+'B(株)','Alias Co '+i]});
  }
  det('customer','お客様5商事株式会社',{dealType:'同業者（フォワーダー・代理店）',tags:['同業者']});
  det('customer','お客様6商事株式会社',{dealType:'同業者（フォワーダー・代理店）',tags:['同業者']});
  const svt=['FCL CARRIER','LCL CARRIER','AIR CARRIER','国内陸送','通関','倉庫','トラック手配','RORO CARRIER'];
  for(let i=1;i<=50;i++){
    const nm=(i%8===0?'ロングネーム運送サービス'+L+i:'テスト運送'+i);
    vote('sv',nm);
    det('sv',nm,{furigana:'てすと'+i,svTypes:svt.slice(0,(i%4)+1),areas:['日本全国','東南アジア','北米','中国'].slice(0,(i%4)+1),group:i%6===0?'CMA CGM グループ':'',
      location:'横浜市中区'+i, contacts:[{name:'担当'+i,dept:'営業',tel:'045-000-000'+i,email:'a'+i+'@x.jp'}]});
    if(i%6===0) db.synonym_groups.push({id:'sg'+i,field:'sv',canonical:nm,aliases:['テスト運輸'+i,'Test Unyu '+i]});
  }
  for(let i=1;i<=40;i++){ const nm='PORT OF LONGNAME '+i; vote('port',nm); det('port',nm,{country:['VN','CN','US','JP'][i%4],furigana:'ぽーと'+i}); }
  for(let i=1;i<=30;i++){ const nm=(i%5===0?'非常に長い名前の費用項目コンテナドレージ付帯作業料金'+i:'運賃'+i); vote('nm',nm); det('nm',nm,{defaultUnit:'CNTR',enName:'Freight '+i}); }
  for(let i=1;i<=10;i++){ vote('un','UNIT'+i); }
  for(let i=1;i<=5;i++){ vote('carrier','CARRIER'+i); }
  for(let i=1;i<=3;i++) db.master_requests.push({id:'rq'+i,field:'sv',value:'申請中の長い名前の運送会社'+L+i,requested_by:ME,status:'pending',created_at:'2026-11-10T00:00:00Z',details:{location:'東京'},note:'申請メモ'+i});
  window.__db=db;
  const qb=t=>{const st={op:'select',filters:[],payload:null,opts:null,one:false,range:null};
    const api={select(){return api},order(){return api},limit(){return api},not(){return api},or(){return api},is(){return api},ilike(){return api},gte(){return api},lte(){return api},
      range(a,z){st.range=[a,z];return api},eq(k,v){st.filters.push(r=>r[k]===v);return api},in(k,vs){st.filters.push(r=>vs.includes(r[k]));return api},
      match(o){st.filters.push(r=>Object.keys(o).every(k=>r[k]===o[k]));return api},
      upsert(o,op){st.op='upsert';st.payload=o;st.opts=op;return api},insert(o){st.op='insert';st.payload=o;return api},update(o){st.op='update';st.payload=o;return api},delete(){st.op='delete';return api},
      single(){st.one=true;return api},maybeSingle(){st.one=true;return api},
      then(res,rej){const rows=(db[t]=db[t]||[]);let data=null;
        if(st.op==='upsert'||st.op==='insert'){[].concat(st.payload).forEach(o=>{const keys=((st.opts&&st.opts.onConflict)||'').split(',').filter(Boolean);const i=keys.length?rows.findIndex(r=>keys.every(k=>r[k]===o[k])):-1;if(i>=0)Object.assign(rows[i],o);else rows.push(Object.assign({id:'id'+Math.random().toString(36).slice(2)},o));});}
        else if(st.op==='delete'){db[t]=rows.filter(r=>!st.filters.every(f=>f(r)));}
        else if(st.op==='update'){rows.filter(r=>st.filters.every(f=>f(r))).forEach(r=>Object.assign(r,st.payload));}
        else{data=rows.filter(r=>st.filters.every(f=>f(r)));if(st.range)data=data.slice(st.range[0],st.range[1]+1);if(st.one)data=data[0]||null;}
        return Promise.resolve({data,error:null}).then(res,rej);}};
    return api;};
  const ch={on(){return ch},subscribe(cb){cb&&cb('SUBSCRIBED');return ch},track(){return Promise.resolve()},untrack(){return Promise.resolve()},presenceState(){return{}},unsubscribe(){return Promise.resolve()},send(){return Promise.resolve()}};
  const user={email:ME,user_metadata:{full_name:'S'}};
  const client={from:qb,rpc:n=>Promise.resolve({data:n==='get_my_role'?'admin':null,error:null}),channel:()=>ch,removeChannel(){},storage:{from:()=>({})},
    auth:{getSession:()=>Promise.resolve({data:{session:{user}}}),onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},signOut:()=>Promise.resolve({}),signInWithOAuth:()=>Promise.resolve({})}};
  window.supabase={createClient:()=>client};
})();
