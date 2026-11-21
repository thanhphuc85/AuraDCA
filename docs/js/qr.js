// QR code generator (version 1-4, ECC-L, byte mode).
// Pure module: text -> inline SVG string. No app-state dependencies.
export const makeQR = (function(){
    var E=[1],L=new Uint8Array(256);
    for(var i=0;i<255;i++){var v=E[i];L[v]=i;E.push(((v<<1)^(v&128?285:0))&255);}
    function ml(a,b){return a&&b?E[(L[a]+L[b])%255]:0;}
    function gp(n){
      var g=[1];
      for(var i=0;i<n;i++){var t=new Array(g.length+1).fill(0);for(var j=0;j<g.length;j++){t[j]^=g[j];t[j+1]^=ml(g[j],E[i]);}g=t;}
      return g;
    }
    function rs(d,n){
      var g=gp(n),r=new Array(n).fill(0);
      for(var i=0;i<d.length;i++){var f=d[i]^r[0];for(var j=0;j<n-1;j++)r[j]=r[j+1]^ml(f,g[j+1]);r[n-1]=ml(f,g[n]);}
      return r;
    }
    var VT=[,[21,19,7],[25,34,10],[29,55,15],[33,80,20]];
    var AL=[,[],[6,18],[6,22],[6,26]];
    var CA=[0,17,32,53,78];
    return function(text,ms){
      var by=[];for(var i=0;i<text.length;i++)by.push(text.charCodeAt(i)&255);
      var vr=1;while(vr<=4&&by.length>CA[vr])vr++;if(vr>4)return'';
      var sz=VT[vr][0],dc=VT[vr][1],ec=VT[vr][2];
      var bi=[];function pb(v,n){for(var i=n-1;i>=0;i--)bi.push((v>>i)&1);}
      pb(4,4);pb(by.length,8);for(var i=0;i<by.length;i++)pb(by[i],8);
      pb(0,Math.min(4,dc*8-bi.length));while(bi.length%8)bi.push(0);
      var cw=[];for(var i=0;i<bi.length;i+=8)cw.push(bi[i]<<7|bi[i+1]<<6|bi[i+2]<<5|bi[i+3]<<4|bi[i+4]<<3|bi[i+5]<<2|bi[i+6]<<1|bi[i+7]);
      var pd=[0xEC,0x11],pi=0;while(cw.length<dc)cw.push(pd[pi++%2]);
      var ecc=rs(cw,ec),all=cw.concat(ecc);
      var g=[],fn=[];for(var r=0;r<sz;r++){g[r]=new Int8Array(sz);fn[r]=new Uint8Array(sz);}
      function st(r,c,v){if(r>=0&&r<sz&&c>=0&&c<sz){g[r][c]=v?1:0;fn[r][c]=1;}}
      function fp(or,oc){for(var r=-1;r<=7;r++)for(var c=-1;c<=7;c++){var rr=or+r,cc=oc+c;if(rr<0||rr>=sz||cc<0||cc>=sz)continue;st(rr,cc,((r===0||r===6||c===0||c===6)||(r>=2&&r<=4&&c>=2&&c<=4))&&!(r===-1||r===7||c===-1||c===7)?1:0);}}
      fp(0,0);fp(0,sz-7);fp(sz-7,0);
      for(var i=8;i<sz-8;i++){st(6,i,i%2===0?1:0);st(i,6,i%2===0?1:0);}
      st(sz-8,8,1);
      if(vr>=2){var ap=AL[vr];for(var ai=0;ai<ap.length;ai++)for(var aj=0;aj<ap.length;aj++){if(fn[ap[ai]][ap[aj]])continue;for(var dr=-2;dr<=2;dr++)for(var dc2=-2;dc2<=2;dc2++)st(ap[ai]+dr,ap[aj]+dc2,Math.abs(dr)===2||Math.abs(dc2)===2||(dr===0&&dc2===0)?1:0);}}
      for(var i=0;i<8;i++){if(!fn[8][i])fn[8][i]=1;if(!fn[i][8])fn[i][8]=1;if(!fn[8][sz-1-i])fn[8][sz-1-i]=1;if(!fn[sz-1-i][8])fn[sz-1-i][8]=1;}
      if(!fn[8][8])fn[8][8]=1;
      var db2=[];for(var i=0;i<all.length;i++)for(var b=7;b>=0;b--)db2.push((all[i]>>b)&1);
      var di=0,col=sz-1,up=true;
      while(col>=0){if(col===6)col--;for(var cnt=0;cnt<sz;cnt++){var row=up?sz-1-cnt:cnt;for(var dx=0;dx<=1;dx++){var cc=col-dx;if(cc<0||fn[row][cc])continue;g[row][cc]=di<db2.length?db2[di]:0;di++;}}up=!up;col-=2;}
      for(var r=0;r<sz;r++)for(var c=0;c<sz;c++)if(!fn[r][c]&&(r+c)%2===0)g[r][c]^=1;
      var fi=0x77c4;
      var p1=[[8,0],[8,1],[8,2],[8,3],[8,4],[8,5],[8,7],[8,8],[7,8],[5,8],[4,8],[3,8],[2,8],[1,8],[0,8]];
      var p2=[];for(var i=0;i<7;i++)p2.push([sz-1-i,8]);for(var i=0;i<8;i++)p2.push([8,sz-8+i]);
      for(var i=0;i<15;i++){var b=(fi>>(14-i))&1;g[p1[i][0]][p1[i][1]]=b;g[p2[i][0]][p2[i][1]]=b;}
      var s=ms||4,q=4,t=(sz+q*2)*s,rects='';
      for(var r=0;r<sz;r++)for(var c=0;c<sz;c++)if(g[r][c])rects+='<rect x="'+((c+q)*s)+'" y="'+((r+q)*s)+'" width="'+s+'" height="'+s+'"/>';
      return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+t+' '+t+'" style="background:#fff;border-radius:8px;"><g fill="#000">'+rects+'</g></svg>';
    };
  })();
