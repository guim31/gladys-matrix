# Matrix

Sprich mit Gladys über [Matrix](https://matrix.org), das offene und dezentrale Nachrichtennetz (Element,
FluffyChat, Cinny…), so wie mit dem Telegram-Bot von Gladys: Stell eine Frage, starte eine Szene, erhalte
die Nachrichten von Gladys. Die Integration schreibt außerdem aus deinen Szenen in Matrix-Räume und startet
Szenen, wenn in einem beobachteten Raum eine Nachricht oder ein Befehl wie `!licht aus` geschrieben wird.
Dafür nutzt die Integration ein eigenes Bot-Konto, auf deinem eigenen Server (Synapse, Conduit, conduwuit, Dendrite…) oder
auf einem öffentlichen wie matrix.org.

> **Ohne die Hardware entwickelt: Rückmeldungen willkommen.** Die Integration wurde mit einem echten
> Conduit-0.10-Server getestet, aber nicht in einem echten Gladys und nicht mit allen Matrix-Clients. Sag
> uns, was funktioniert und was nicht, in den [Issues](https://github.com/guim31/gladys-matrix/issues)
> oder im [Gladys-Forum](https://community.gladysassistant.com).

## Was du brauchst

- Gladys Assistant **5.1.0** oder neuer.
- Ein **eigenes Matrix-Konto für den Bot** (zum Beispiel `@gladys:example.org`), auf einem Server, den
  Gladys erreicht: dein Server im lokalen Netz oder ein öffentlicher Server im Internet. Nimm nicht dein
  persönliches Konto: Der Bot antwortet in seinem Namen.
- **Räume ohne Ende-zu-Ende-Verschlüsselung.** Der Bot kann verschlüsselte Räume nicht lesen (Element
  verschlüsselt private Räume und Direktnachrichten standardmäßig: Schalte die Option beim Erstellen des
  Raums aus, sie lässt sich danach nicht mehr ändern).
- Die Matrix-ID jeder Person, die mit dem Bot sprechen darf, etwa `@alice:example.org`.

## Einrichtung

1. Leg das Bot-Konto an (auf matrix.org: eine normale Registrierung; auf deinem Server: wie die anderen
   Konten).
2. In Gladys **Integrationen → Matrix → Konfiguration**:
   - **Adresse des Matrix-Servers**: die Client-API des Servers, zum Beispiel `https://matrix.org` oder
     `http://192.168.1.20:8008`. Bei einem Server hinter seinem Domainnamen ist es oft `https://matrix.`
     gefolgt von der Domain.
   - **Benutzername des Bots** und **Passwort des Bots**: Der Bot meldet sich einmal an und behält sein
     Zugriffstoken in den Daten der Integration. Oder trag unter **Zugriffstoken (statt des Passworts)**
     ein Token des Bot-Kontos ein: Benutzername und Passwort werden dann nicht verwendet.
   - **Erlaubte Personen**: die Matrix-IDs, auf die der Bot hört, durch Kommas getrennt. **Leer antwortet
     der Bot niemandem**: Er ignoriert die Nachrichten und Einladungen aller, die nicht in dieser Liste
     stehen.
   - **Beobachtete Räume**: die Räume, deren Nachrichten Szenen starten, per Alias (`#zuhause:example.org`)
     oder per ID (`!abc…:example.org`, in den Raumeinstellungen unter „Erweitert“), durch Kommas getrennt.
     Lade den Bot zuerst in einen privaten Raum ein: Den Räumen dieser Liste tritt er selbst bei.
   - **Befehlspräfix**: standardmäßig `!`.
   - **Sprache des Bots**: die Sprache dessen, was der Bot schreibt, bevor eine Person verknüpft ist.
3. Klicke auf **Verbindung testen**: Der Bericht nennt das Konto des Bots, die betretenen beobachteten
   Räume und die Zahl der erlaubten Personen. Der Verbindungsstatus der Seite zeigt es ebenfalls.

### Dein Matrix-Konto verknüpfen, um mit Gladys zu sprechen

Jeder Gladys-Benutzer, der über Matrix mit Gladys sprechen will, macht das einmal:

1. Erstelle in Matrix einen **privaten Raum ohne Verschlüsselung** und lade den Bot ein (nur erlaubte
   Personen: Der Bot ignoriert die Einladungen aller anderen). Er tritt sofort bei.
2. In Gladys **Integrationen → Matrix → Konfiguration**, Block „Mein Konto verknüpfen“: Klicke auf
   **Verknüpfungscode generieren**.
3. Schick den Code (8 Zeichen) in diesem Raum an den Bot. Der Bot bestätigt: Dein Matrix-Konto ist mit
   deinem Gladys-Benutzer verknüpft. Im selben Block kannst du es wieder trennen.

## Was der Bot macht

- **In einem privaten Raum** (ein Raum nur mit dir und dem Bot, kein beobachteter Raum; in einem nicht beobachteten Gruppenraum schweigt der Bot): Er gibt deine
  Nachrichten an Gladys weiter, mit den Rechten des verknüpften Gladys-Benutzers, genau wie der
  Telegram-Bot: „Wie warm ist es im Wohnzimmer?“, „Schalte das Licht aus“. Die Antworten von Gladys kommen
  in diesem Raum zurück. Die Nachrichten, die Gladys dir schickt (die Szenenaktion **Nachricht senden**, die
  Systemnachrichten), kommen auch dort an, mit dargestelltem Markdown. Schreibt Gladys einer verknüpften
  Person vor jedem Gespräch, öffnet der Bot mit ihr einen unverschlüsselten privaten Raum. Ein Kamerabild
  aus einer Szene kommt als Bild an.
- **In einem beobachteten Raum**: Jede Nachricht einer erlaubten Person startet den Auslöser
  **Matrix-Nachricht empfangen**, und eine Nachricht, die mit dem Präfix beginnt, startet zusätzlich
  **Matrix-Befehl empfangen**. Der Bot antwortet dort nie von sich aus: Was passiert, bestimmen deine
  Szenen.
- **Was er ignoriert**: alle, die keine erlaubte Person sind, seine eigenen Nachrichten, Bearbeitungen
  einer Nachricht, Hinweise (was andere Bots schreiben) und Nachrichten, die beim Lesen älter als
  5 Minuten sind (geschrieben, während Gladys oder der Bot gestoppt war: Ein „!garage auf“ von vor zwei
  Stunden wird jetzt nicht ausgeführt).
- **In einem verschlüsselten Raum**: Er kann die Nachricht nicht lesen und sagt das einmal in diesem Raum.

## Dashboard

Das Widget **Matrix** zeigt, ob der Bot verbunden ist, sein Konto, die beobachteten Räume, in denen er ist,
die letzten 5 Nachrichten aus den beobachteten Räumen (Absender, Text, Datum) und einen Knopf **Verbindung
testen**. Die privaten Gespräche mit Gladys erscheinen dort nie: Wer das Dashboard sieht, sieht das Widget.

## Szenen

### Auslöser

- **Matrix-Nachricht empfangen**: Eine erlaubte Person hat in einem beobachteten Raum geschrieben. Filter
  (leer = beliebig): **Raum** (so geschrieben wie in der Konfiguration, zum Beispiel
  `#zuhause:example.org`) und **Absender** (`@alice:example.org`). Variablen: Nachricht, Absender, Raum,
  Raum-ID.
- **Matrix-Befehl empfangen**: Eine erlaubte Person hat in einem beobachteten Raum einen Befehl
  geschrieben: das Präfix, dann ein Wort, dann optionale Argumente, zum Beispiel `!licht aus küche`. Filter
  **Befehl**: das Wort **ohne Präfix, kleingeschrieben** (`licht`); dazu Raum und Absender. Variablen:
  Befehl (`licht`), Argumente (`aus küche`), Nachricht, Absender, Raum, Raum-ID. Dieselbe Nachricht startet
  auch **Matrix-Nachricht empfangen**.
- **Matrix-Verbindung verloren**: Der Bot erreicht den Matrix-Server seit einer Minute nicht mehr, oder
  seine Zugangsdaten werden abgelehnt. Variable: Fehler. Einmal gestartet, bis die Verbindung zurück ist.
- **Matrix-Verbindung wiederhergestellt**: Der Bot erreicht den Server nach einem Verbindungsverlust
  wieder. Variable: Bot-Konto.

### Aktionen

- **Matrix-Nachricht senden**: schreibt eine Nachricht in einen Raum, per Alias oder ID. Die Nachricht
  nimmt Szenenvariablen und Markdown an (`**fett**`, `_kursiv_`, Listen, Links). **Dezent (Hinweis, ohne
  Alarm)** sendet einen Hinweis, den Matrix-Clients ohne Alarm anzeigen. Der Bot muss im Raum sein oder
  ihm beitreten können (eingeladen oder öffentlicher Raum). Ergebnisse: Gesendet (ja/nein), Ereignis-ID,
  Fehler. Eine fehlgeschlagene Nachricht stoppt die Szene nicht: Prüfe **Gesendet** bei Bedarf mit einer
  Bedingung.

Um einem Gladys-Benutzer statt einem Raum zu schreiben, nimm die Aktion **Nachricht senden** von Gladys:
Damit erreichst du sein verknüpftes Matrix-Konto.

### Szenenideen

- **Garage per Befehl**: Auslöser **Matrix-Befehl empfangen**, Befehl `garage`, Raum
  `#zuhause:example.org`; dann eine Bedingung auf die Variable Argumente gleich `zu`, und die Aktion, die
  das Garagentor schließt.
- **Klingel im Familienraum**: Auslöser auf die Klingel, dann **Matrix-Nachricht senden** an
  `#zuhause:example.org`: „Es hat um {{ uhrzeit }} geklingelt“, gefolgt von der Aktion des Kerns, die das
  Kamerabild an einen Benutzer schickt.
- **Warnung, wenn der Bot getrennt ist**: Auslöser **Matrix-Verbindung verloren**, dann eine
  Benachrichtigung über einen anderen Kanal (Gotify, ntfy, SMS) mit der Variable Fehler.

## Fehlerbehebung

- **„kein Matrix-Server unter dieser Adresse“**: Die Adresse ist die der Client-API, nicht die Seite des
  Web-Clients Element. Öffne `https://<adresse>/_matrix/client/versions` im Browser: Es muss eine Liste von
  Versionen kommen.
- **„Benutzername oder Passwort des Bots abgelehnt“**: Prüfe sie, indem du dich mit dem Bot-Konto in
  Element anmeldest. Ein Konto, das nur per Single Sign-On (SSO) geschützt ist, hat kein Passwort: Nimm
  ein Zugriffstoken.
- **„Zugriffstoken abgelehnt“**: Das Token wurde widerrufen (Abmeldung dieser Sitzung) oder ist
  abgelaufen. Gib ein neues ein, oder Benutzername und Passwort.
- **Einem beobachteten Raum wurde nicht beigetreten**: Der Status der Seite und der Test nennen ihn. Lade
  den Bot in den Raum ein (oder mach ihn öffentlich) und speichere dann die Konfiguration erneut.
- **Der Bot antwortet mir nicht**: Steht deine Matrix-ID unter **Erlaubte Personen**, genau geschrieben
  (mit `@` und Server)? Ist der Raum unverschlüsselt? Ist in einem privaten Raum dein Konto verknüpft (der
  Bot erklärt dir sonst das Vorgehen)?
- **Ein Befehl startet die Szene nicht**: Der Filter Befehl ist das Wort ohne Präfix, kleingeschrieben:
  `licht`, nicht `!Licht`.
- Mehr Details in den Logs der Integration mit `LOG_LEVEL=debug`.

## Grenzen

- **Keine Ende-zu-Ende-Verschlüsselung**: Der Bot liest und schreibt nur in unverschlüsselten Räumen.
  Seine Nachrichten reisen verschlüsselt zwischen deinem Client, dem Server und Gladys (HTTPS), liegen aber
  lesbar auf dem Matrix-Server.
- Eine mit Gladys verknüpfte Person kann über Matrix alles tun, was ihr Gladys-Benutzer darf: Halte die
  Liste der erlaubten Personen kurz und schütze das Bot-Konto (starkes Passwort, nie wiederverwendet).
- Ein Bot-Konto pro Gladys. Der Bot liest die Nachrichten per Long Polling von 30 Sekunden: Ein Befehl
  wirkt nach etwa einer Sekunde.
- Bilder, Dateien und Sprachnachrichten an den Bot werden ignoriert; nur Text zählt.
- Das Bot-Konto unterliegt den Ratenbegrenzungen seines Servers: matrix.org bremst Konten, die viel senden;
  halte deine Szenen maßvoll.
- Nicht mit der Matrix.org Foundation verbunden. Matrix ist eine Marke von The Matrix.org Foundation C.I.C.
