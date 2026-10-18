export const DEFAULT_VOICE = 'doubao:random';
export const VOICES = [{ id: DEFAULT_VOICE, label: '随机音色（小何、Vivi、咪仔、桃子、梓梓）' }];
export const SPEAKER_NAMES = Object.freeze({
  zh_female_xiaohe_uranus_bigtts: '小何',
  zh_female_vv_uranus_bigtts: 'Vivi',
  zh_female_mizai_uranus_bigtts: '咪仔',
  zh_female_tianmeitaozi_uranus_bigtts: '桃子',
  zh_female_qingchezizi_uranus_bigtts: '梓梓'
});

// Earlier versions saved device-specific voice names, or an empty automatic
// selection. Resolve those preferences to the same cloud voice on every device.
export function resolveVoice(name) {
  return DEFAULT_VOICE;
}
