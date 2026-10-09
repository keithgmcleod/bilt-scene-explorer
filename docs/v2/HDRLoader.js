import { DataTextureLoader, FloatType, LinearFilter, LinearSRGBColorSpace } from 'three';
export class HDRLoader extends DataTextureLoader {
  constructor(manager) { super(manager); this.type = FloatType; }
  setDataType(type) { this.type = type; return this; }
  parse(buffer) {
    const bytes = new Uint8Array(buffer); let offset = 0;
    const line = () => { let start=offset; while(offset<bytes.length && bytes[offset]!==10) offset++; return new TextDecoder().decode(bytes.subarray(start,offset++)); };
    if (!line().startsWith('#?')) throw new Error('Invalid HDR header');
    let dimensions, format=false;
    while(offset<bytes.length) { const value=line(); if(value==='FORMAT=32-bit_rle_rgbe') format=true; dimensions=value.match(/^-Y (\d+) \+X (\d+)$/); if(dimensions) break; }
    if(!format || !dimensions) throw new Error('Unsupported HDR format');
    const height=Number(dimensions[1]), width=Number(dimensions[2]);
    const rgba=new Float32Array(width*height*4), scan=new Uint8Array(width*4);
    for(let y=0;y<height;y++) {
      if(bytes[offset]!==2 || bytes[offset+1]!==2 || ((bytes[offset+2]<<8)|bytes[offset+3])!==width) throw new Error('Invalid HDR scanline');
      offset+=4;
      for(let channel=0;channel<4;channel++) {
        let x=0;
        while(x<width) {
          let count=bytes[offset++]; const run=count>128; if(run) count-=128;
          if(!count || x+count>width || offset>=bytes.length) throw new Error('Corrupt HDR data');
          if(run) { const value=bytes[offset++]; scan.fill(value,channel*width+x,channel*width+x+count); }
          else { if(offset+count>bytes.length) throw new Error('Truncated HDR'); scan.set(bytes.subarray(offset,offset+count),channel*width+x); offset+=count; }
          x+=count;
        }
      }
      for(let x=0;x<width;x++) { const i=(y*width+x)*4; const scale=scan[width*3+x] ? Math.pow(2,scan[width*3+x]-128)/256 : 0; rgba[i]=scan[x]*scale; rgba[i+1]=scan[width+x]*scale; rgba[i+2]=scan[width*2+x]*scale; rgba[i+3]=1; }
    }
    return {width,height,data:rgba,type:FloatType};
  }
  load(url,onLoad,onProgress,onError) {
    return super.load(url,(texture,data)=> {texture.colorSpace=LinearSRGBColorSpace;texture.minFilter=texture.magFilter=LinearFilter;texture.generateMipmaps=false;texture.flipY=true;if(onLoad)onLoad(texture,data)},onProgress,onError);
  }
}
