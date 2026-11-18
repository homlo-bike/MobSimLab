import type { streetPhotosEn } from "./en";

/** Қазақша: messages of the map's Street photos panel. */
export const streetPhotosKk: Record<keyof typeof streetPhotosEn, string> = {
  "photos.button": "Көше фотолары",
  "photos.title": "Көше фотолары",
  "photos.source": "Дереккөз",
  "photos.hint":
    "Картадағы сызықтар фотолар қай жерде түсірілгенін көрсетеді. Жақын маңда түсірілген фотоларды көру үшін картадағы нүктені басыңыз.",
  "photos.zoomIn":
    "Фотолар қай жерде түсірілгенін көру үшін картаны үлкейтіп, содан кейін картадағы нүктені басыңыз.",
  "photos.searching": "Фотолар ізделуде…",
  "photos.none": "Бұл нүктеден {radius} м ішінде фото жоқ. Сызыққа жақынырақ басыңыз.",
  "photos.failed": "Фотолар жүктелмеді: {error}",
  "photos.count": "{count} фотоның {n}-сі",
  "photos.previous": "Алдыңғы",
  "photos.next": "Келесі",
  "photos.thumbs": "Осы нүкте маңындағы фотолар",
  "photos.alt": "Басылған нүкте маңындағы көше фотосы {n}",
  "photos.imageFailed": "Бұл фото жүктелмеді.",
  "photos.panorama": "360° фото",
  "photos.distance": "нүктеден {m} м",
  "photos.taken": "{date} түсірілген",
  "photos.by": "Авторы: {author}",
  "photos.licence": "Лицензия: {licence}",
  "photos.open": "{name} ішінде ашу",
  "photos.notSaved": "Фотолар {name} көзінен алынады және жобамен бірге сақталмайды.",
};
