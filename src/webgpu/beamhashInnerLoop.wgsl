struct Params {
  prePow : array<vec2<u32>, 4>,
  baseNonce : u32,
  nonceCount : u32,
  mixSeed : u32,
  _pad : u32,
};

struct OutputData {
  accumLo : atomic<u32>,
  accumHi : atomic<u32>,
};

struct U64 {
  lo : u32,
  hi : u32,
};

struct StepElem {
  work : array<U64, 7u>,
};

const WORK_WORDS : u32 = 7u;
const NUM_INDICES : u32 = 32u;
const COLLISION_BITS : u32 = 24u;
const WORK_BITS : u32 = 448u;
const FULL_BITS : u32 = 512u;

@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read_write> output : OutputData;

fn make_u64(lo : u32, hi : u32) -> U64 {
  return U64(lo, hi);
}

fn zero_u64() -> U64 {
  return U64(0u, 0u);
}

fn from_u32(value : u32) -> U64 {
  return U64(value, 0u);
}

fn add_u64(a : U64, b : U64) -> U64 {
  let lo = a.lo + b.lo;
  let carry = select(0u, 1u, lo < a.lo);
  let hi = a.hi + b.hi + carry;
  return U64(lo, hi);
}

fn xor_u64(a : U64, b : U64) -> U64 {
  return U64(a.lo ^ b.lo, a.hi ^ b.hi);
}

fn shl_u64(value : U64, shift : u32) -> U64 {
  let s = shift & 63u;
  if (s == 0u) {
    return value;
  }
  if (s < 32u) {
    let newLo = value.lo << s;
    let newHi = (value.hi << s) | (value.lo >> (32u - s));
    return U64(newLo, newHi);
  }
  if (s < 64u) {
    let newHi = value.lo << (s - 32u);
    return U64(0u, newHi);
  }
  return U64(0u, 0u);
}

fn shr_u64(value : U64, shift : u32) -> U64 {
  let s = shift & 63u;
  if (s == 0u) {
    return value;
  }
  if (s < 32u) {
    let newHi = value.hi >> s;
    let newLo = (value.lo >> s) | (value.hi << (32u - s));
    return U64(newLo, newHi);
  }
  if (s < 64u) {
    let newLo = value.hi >> (s - 32u);
    return U64(newLo, 0u);
  }
  return U64(0u, 0u);
}

fn rotl_u64(value : U64, shift : u32) -> U64 {
  let s = shift & 63u;
  if (s == 0u) {
    return value;
  }
  let left = shl_u64(value, s);
  let right = shr_u64(value, 64u - s);
  return U64(left.lo | right.lo, left.hi | right.hi);
}

fn load_pre_pow(index : u32) -> U64 {
  let pair = params.prePow[index];
  return U64(pair.x, pair.y);
}

fn sip_round(v0 : ptr<function, U64>, v1 : ptr<function, U64>, v2 : ptr<function, U64>, v3 : ptr<function, U64>) {
  *v0 = add_u64(*v0, *v1);
  *v2 = add_u64(*v2, *v3);
  *v1 = rotl_u64(*v1, 13u);
  *v3 = rotl_u64(*v3, 16u);
  *v1 = xor_u64(*v1, *v0);
  *v3 = xor_u64(*v3, *v2);
  *v0 = rotl_u64(*v0, 32u);
  *v2 = add_u64(*v2, *v1);
  *v0 = add_u64(*v0, *v3);
  *v1 = rotl_u64(*v1, 17u);
  *v3 = rotl_u64(*v3, 21u);
  *v1 = xor_u64(*v1, *v2);
  *v3 = xor_u64(*v3, *v0);
  *v2 = rotl_u64(*v2, 32u);
}

fn siphash24(state : array<U64, 4>, nonce : U64) -> U64 {
  var v0 = state[0];
  var v1 = state[1];
  var v2 = state[2];
  var v3 = state[3];
  v3 = xor_u64(v3, nonce);
  sip_round(&v0, &v1, &v2, &v3);
  sip_round(&v0, &v1, &v2, &v3);
  v0 = xor_u64(v0, nonce);
  v2 = xor_u64(v2, from_u32(0xffu));
  sip_round(&v0, &v1, &v2, &v3);
  sip_round(&v0, &v1, &v2, &v3);
  sip_round(&v0, &v1, &v2, &v3);
  sip_round(&v0, &v1, &v2, &v3);
  return xor_u64(xor_u64(v0, v1), xor_u64(v2, v3));
}

fn words_to_bytes(words : ptr<function, array<U64, 7u>>) -> array<u32, 56u> {
  var bytes : array<u32, 56u>;
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    let word = (*words)[i];
    bytes[i * 8u + 0u] = (word.hi >> 24u) & 0xffu;
    bytes[i * 8u + 1u] = (word.hi >> 16u) & 0xffu;
    bytes[i * 8u + 2u] = (word.hi >> 8u) & 0xffu;
    bytes[i * 8u + 3u] = word.hi & 0xffu;
    bytes[i * 8u + 4u] = (word.lo >> 24u) & 0xffu;
    bytes[i * 8u + 5u] = (word.lo >> 16u) & 0xffu;
    bytes[i * 8u + 6u] = (word.lo >> 8u) & 0xffu;
    bytes[i * 8u + 7u] = word.lo & 0xffu;
  }
  return bytes;
}

fn bytes_to_words(bytes : ptr<function, array<u32, 56u>>) -> array<U64, 7u> {
  var words : array<U64, 7u>;
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    let hi = ((*bytes)[i * 8u + 0u] << 24u) |
             ((*bytes)[i * 8u + 1u] << 16u) |
             ((*bytes)[i * 8u + 2u] << 8u) |
             (*bytes)[i * 8u + 3u];
    let lo = ((*bytes)[i * 8u + 4u] << 24u) |
             ((*bytes)[i * 8u + 5u] << 16u) |
             ((*bytes)[i * 8u + 6u] << 8u) |
             (*bytes)[i * 8u + 7u];
    words[i] = U64(lo, hi);
  }
  return words;
}

fn step_elem_init(prePow : array<U64, 4>, index : u32) -> StepElem {
  var elem : StepElem;
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    let j = WORK_WORDS - 1u - i;
    let nonce = from_u32((index << 3u) + j);
    elem.work[j] = siphash24(prePow, nonce);
  }
  return elem;
}

fn merge_with(target : ptr<function, StepElem>, other : StepElem, remLen : u32) {
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    (*target).work[i] = xor_u64((*target).work[i], other.work[i]);
  }
  var bytes = words_to_bytes(&(*target).work);
  let remBytes = remLen >> 3u;
  let collisionBytes = COLLISION_BITS >> 3u;
  for (var i = 0u; i < remBytes; i = i + 1u) {
    let src = i + collisionBytes;
    bytes[i] = select(0u, bytes[src], src < 56u);
  }
  for (var i = remBytes; i < 56u; i = i + 1u) {
    bytes[i] = 0u;
  }
  let updated = bytes_to_words(&bytes);
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    (*target).work[i] = updated[i];
  }
}

fn apply_mix(target : ptr<function, StepElem>, remLen : u32, start : u32, count : u32, indices : ptr<function, array<u32, NUM_INDICES>>) {
  var temp : array<U64, 9u>;
  for (var i = 0u; i < WORK_WORDS; i = i + 1u) {
    temp[i] = (*target).work[i];
  }
  for (var i = WORK_WORDS; i < 9u; i = i + 1u) {
    temp[i] = zero_u64();
  }
  let padMax = ((FULL_BITS - remLen) + COLLISION_BITS) / (COLLISION_BITS + 1u);
  var padNum = padMax;
  if (padNum > count) {
    padNum = count;
  }
  for (var i = 0u; i < padNum; i = i + 1u) {
    let nShift = remLen + i * (COLLISION_BITS + 1u);
    let base = nShift / 64u;
    let shift = nShift & 63u;
    let idxValue = (*indices)[start + i];
    let low = from_u32(idxValue);
    temp[base] = xor_u64(temp[base], shl_u64(low, shift));
    if (shift + COLLISION_BITS + 1u > 64u) {
      temp[base + 1u] = xor_u64(temp[base + 1u], shr_u64(low, 64u - shift));
    }
  }
  var result = zero_u64();
  for (var i = 0u; i < 8u; i = i + 1u) {
    let rot = ((29u * (i + 1u)) & 63u);
    result = add_u64(result, rotl_u64(temp[i], rot));
  }
  result = rotl_u64(result, 24u);
  (*target).work[0] = result;
}

fn has_collision(a : StepElem, b : StepElem) -> bool {
  let delta = xor_u64(a.work[0], b.work[0]);
  let mask = (1u << COLLISION_BITS) - 1u;
  return (delta.lo & mask) == 0u;
}

fn process_nonce(prePow : array<U64, 4>, nonceVal : u32, seed : u32) -> U64 {
  var indices : array<u32, NUM_INDICES>;
  var state = seed ^ nonceVal;
  for (var i = 0u; i < NUM_INDICES; i = i + 1u) {
    state = state * 1664525u + 1013904223u;
    indices[i] = state & ((1u << 25u) - 1u);
  }
  var elems : array<StepElem, NUM_INDICES>;
  for (var i = 0u; i < NUM_INDICES; i = i + 1u) {
    elems[i] = step_elem_init(prePow, indices[i]);
  }
  var round = 1u;
  var step = 1u;
  loop {
    if (step >= NUM_INDICES) {
      break;
    }
    var i0 = 0u;
    loop {
      if (i0 >= NUM_INDICES) {
        break;
      }
      var remLen = WORK_BITS - (round - 1u) * COLLISION_BITS;
      if (round == 5u) {
        remLen = remLen - 64u;
      }
      apply_mix(&elems[i0], remLen, i0, step, &indices);
      let i1 = i0 + step;
      apply_mix(&elems[i1], remLen, i1, step, &indices);
      if (!has_collision(elems[i0], elems[i1])) {
        return make_u64(0u, 1u);
      }
      remLen = WORK_BITS - round * COLLISION_BITS;
      if (round == 4u) {
        remLen = remLen - 64u;
      }
      if (round == 5u) {
        remLen = COLLISION_BITS;
      }
      merge_with(&elems[i0], elems[i1], remLen);
      i0 = i1 + step;
    }
    round = round + 1u;
    step = step << 1u;
  }
  return elems[0].work[0];
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id : vec3<u32>) {
  let idx = global_id.x;
  if (idx >= params.nonceCount) {
    return;
  }
  var prePow : array<U64, 4>;
  for (var i = 0u; i < 4u; i = i + 1u) {
    prePow[i] = load_pre_pow(i);
  }
  let nonceVal = params.baseNonce + idx;
  let finalWord = process_nonce(prePow, nonceVal, params.mixSeed);
  atomicAdd(&output.accumLo, finalWord.lo);
  atomicAdd(&output.accumHi, finalWord.hi);
}
