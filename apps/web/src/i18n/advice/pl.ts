import type { AdviceMessages } from "./en";

/** Advice messages (pl). */
export const advicePl = {
  "advice.title": "Co poprawić",
  "advice.intro":
    "Problemy znalezione w tym przebiegu, najpoważniejszy najpierw, i co można zrobić z każdym z nich.",
  "advice.none": "Nic do poprawy: ten przebieg nie znalazł wąskiego gardła ani problemu.",
  "advice.show": "Pokaż na mapie",
  "advice.more": "Jeszcze {n} niepokazanych.",
  "advice.severity.problem": "Problem",
  "advice.severity.warning": "Ostrzeżenie",
  "advice.crowdMap": "Pokaż na mapie zapełnienie pojazdów (najbardziej obciążona godzina każdej linii)",
  "advice.cap.stopped": "{line}: przebieg zatrzymał się: {problem}",
  "advice.cap.stoppedFix": "Popraw to w narzędziu kolejowym, a potem uruchom test ponownie.",
  "advice.cap.unplaced": "{line}: kursy, które nie mieszczą się na torach: {n}",
  "advice.cap.unplacedFix":
    "Uruchamiaj linię rzadziej w tym okresie albo daj jej pociągom więcej miejsca tam, gdzie się spotykają: więcej torów przy peronach lub przejazdów rozjazdowych w {terminal} albo mijankę na linii jednotorowej.",
  "advice.cap.terminal":
    "{line}: stacja końcowa {terminal} jest wąskim gardłem, zajęta przez {share} najbardziej obciążonej godziny (limit {limit})",
  "advice.cap.terminalFix":
    "Pociągi zbyt długo zajmują jej tory przy peronach. Skróć zawracanie (krótszy postój albo maszynista czekający na każdym końcu), dodaj tor przy peronie albo przesuń przejazd rozjazdowy bliżej peronów, aby pociągi wcześniej go zwalniały.",
  "advice.cap.section":
    "{line}: odcinek toru {section} jest wąskim gardłem, zajęty przez {share} najbardziej obciążonej godziny (limit {limit})",
  "advice.cap.sectionFix":
    "Pociągi zajmują ten odcinek dłużej niż jakikolwiek inny. Wyższa prędkość na nim pozwala wcześniej go zwolnić; w przeciwnym razie puść tu mniej pociągów.",
  "advice.cap.sectionPlatform":
    "Ten odcinek to tor przy peronie: pociągi zajmują go, stojąc przy peronie. Krótsze postoje albo drugi tor przy peronie dla tego kierunku wpuszczają następny pociąg wcześniej.",
  "advice.cap.sectionSwitches":
    "Ten odcinek to okręg zwrotnicowy: pociągi zajmują go, gdy ich przebieg przez rozjazdy jest nastawiany i zwalniany. Rozjazdy z wyższą prędkością na kierunek zwrotny albo ułożone tak, by oba kierunki się nie krzyżowały, zwalniają go wcześniej.",
  "advice.cap.signalAdd":
    "Ten odcinek szlaku ma {length} m, a odstęp blokowy przy {speed} km/h wymaga tylko {block} m. Dodaj semafor odstępowy około {at} m na torze {track}, aby następny pociąg mógł wcześniej wjechać na pierwszą połowę.",
  "advice.cap.signalShort":
    "Ten odcinek ma {length} m, mniej niż dwa odstępy blokowe po {block} m przy {speed} km/h, więc kolejny semafor zostawiłby za mało miejsca na zatrzymanie. Pociągi mogą jeździć bliżej siebie z sygnalizacją kabinową (CBTC lub ETCS poziom 2) albo z niższą prędkością tutaj.",
  "advice.cap.sectionCab":
    "Przy sygnalizacji kabinowej pociągi już jadą w odstępie drogi hamowania ({block} m przy {speed} km/h); to nie semafory wyznaczają odstęp. Wyższa prędkość na odcinku albo mniej pociągów zwalnia go wcześniej.",
  "advice.cap.sectionSight":
    "Tramwaje jeżdżą tu na widoczność, więc to nie sygnały wyznaczają odstęp. Krótsze postoje w pobliżu albo własne torowisko z dala od ruchu ulicznego zwalniają go wcześniej.",
  "advice.cap.nearNote": "To jeszcze działa, ale jest mało miejsca na dodatkowe pociągi.",
  "advice.cap.pileUp": "{line}: opóźnienia narastają i na koniec okresu wynoszą średnio jeszcze {late}",
  "advice.cap.pileUpFix":
    "Dodaj rezerwę czasu na stacjach końcowych albo jeźdź nieco rzadziej, aby spóźniony pociąg nie zatrzymywał następnego.",
  "advice.cap.full": "{line}: pojazdy są zapełnione w {share} od {from} do {to}, {time}",
  "advice.cap.fullMore":
    "{left} osób zostaje na przystankach w tym okresie. Tor pozwala na maksymalnie {n} pociągów na godzinę w każdym kierunku: jeźdź częściej albo użyj dłuższych pociągów.",
  "advice.cap.fullLonger":
    "{left} osób zostaje na przystankach w tym okresie. Jeźdź częściej, jeśli tor na to pozwala, albo użyj dłuższych pojazdów.",
  "advice.cap.streetPileUp": "{line}: opóźnienia narastają na ulicy i na końcu wynoszą jeszcze {late}",
  "advice.cap.streetPileUpFix":
    "Zaplanuj więcej czasu na obieg albo dłuższy postój na pętlach, aby pojazdy mogły nadrobić; najbardziej pomaga własny pas tam, gdzie spotykają ruch.",
  "advice.road.cannotRun": "{line} nie mogła kursować",
  "advice.road.cannotRunFix":
    "{problem}. Popraw linię w Tworzenie → Linie drogowe, a potem uruchom ponownie.",
  "advice.road.late": "{line}: tylko {share} odjazdów punktualnie (porada poniżej {limit})",
  "advice.road.mostlySignals":
    "Każdy kurs traci {signals} min na czerwonym świetle i {traffic} min w ruchu, więc najwięcej na wymienionych tu sygnalizacjach.",
  "advice.road.mostlyTraffic":
    "Każdy kurs traci {traffic} min w ruchu i {signals} min na czerwonym świetle, więc najwięcej na wymienionych tu ulicach.",
  "advice.road.moreTime":
    "Obieg trwał {run} min wobec {planned} min planowanych: zaplanuj więcej czasu jazdy albo dodaj pojazd.",
  "advice.road.bunched": "{line}: {share} odjazdów przyjeżdża w grupach",
  "advice.road.bunchedFix":
    "Pojazdy doganiają się nawzajem. Wstrzymuj je na pętlach według rozkładu, daj tam dłuższy postój albo daj linii własny pas tam, gdzie traci czas.",
  "advice.road.ranOut": "{line}: pojazdy, którym skończyła się energia: {n}",
  "advice.road.ranOutFix": "Użyj większej baterii, ładuj na pętlach albo wymieniaj pojazdy w ciągu dnia.",
  "advice.road.stuck": "{line}: pojazdy unieruchomione na 5 minut lub dłużej: {n}",
  "advice.road.stuckFix":
    "Sprawdź na karcie GIS ustawienia ulicy i sygnalizację w tym miejscu: może brakować skrętu albo ruch blokuje skrzyżowanie.",
  "advice.road.notBack": "{line}: pojazdy, które nie wróciły do zajezdni na koniec: {n}",
  "advice.road.notBackFix":
    "Sprawdź trasę między linią a jej zajezdnią albo zostaw więcej czasu po ostatnim kursie.",
  "advice.road.unnamedStreet": "ulica bez nazwy",
  "advice.road.unnamedJunction": "skrzyżowanie",
  "advice.road.spot.signal": "Czerwone światło: {place}: łącznie {min} min straty ({lines})",
  "advice.road.spot.signalFix":
    "Linie czekają tu dłużej niż gdziekolwiek indziej. Poproś o priorytet dla nich na tej sygnalizacji albo o program sygnalizacji, który im odpowiada. Symulacja drogowa nie modeluje jeszcze priorytetu, więc nie może pokazać zysku.",
  "advice.road.spot.street": "Ruch: {place}: łącznie {min} min straty ({lines})",
  "advice.road.spot.streetFix":
    "Daj liniom własny pas na tej ulicy (karta GIS, ustawienia ulicy: buspas) albo poprowadź je inną ulicą.",
  "advice.road.spot.junction": "Postój: {place}: łącznie {min} min straty ({lines})",
  "advice.road.spot.junctionFix":
    "Pojazdy stoją wewnątrz tego skrzyżowania, czekając na skręt albo na zwolnienie wyjazdu. Pomaga własny pas aż do niego albo osobna faza skrętu na sygnalizacji.",
} satisfies AdviceMessages;
