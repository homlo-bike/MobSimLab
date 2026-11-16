import type { MslabMessages } from "./en";

/** .mslab project file messages (pl). */
export const mslabPl = {
  "menu.saveMslab": "Zapisz jako plik .mslab",
  "home.openMslab": "Otwórz plik .mslab",
  "home.openingMslab": "Otwieranie pliku…",
  "home.openedMslab": "Otwarto „{name}” jako nowy projekt.",
  "home.leftOut": "Pominięto: {list}",
  "mslab.body":
    "Zapisuje rysunki, ustawienia, scenariusze i wtyczki projektu w jednym pliku, który można ponownie otworzyć w dowolnym MobSimLab.",
  "mslab.runs": "Dołącz zapisane symulacje (plik będzie większy)",
  "mslab.map":
    "Dołącz dane mapy dla statycznej przeglądarki: ulice, budynki, ludność i dane kraju z obszaru projektu (większy plik; może potrwać kilka minut)",
  "static.empty":
    "Ta witryna nie ma jeszcze projektów. Umieść pliki .mslab w folderze projects i uruchom tools/add-projects.mjs.",
  "mslab.save": "Zapisz plik",
} satisfies MslabMessages;
