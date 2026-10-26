"""Seed sourced position corrections (owner, 2026-10-25) for the Tic-Tac-Toe position columns (Guard / Forward / Center).

The standard: a player's positions are the NBA's official listing (nba_api commonplayerinfo POSITION, what
players_curated.json holds) plus any position Basketball-Reference's player page adds; a hybrid counts for both
(Jayson Tatum stays G-F). 52 players had no position at all, so they failed every position column, and three missed
one against Basketball-Reference: Chris Bosh and Serge Ibaka (F -> F-C), Evan Mobley (C -> F-C). Each is an active
DataCorrection on `position`, overlaid wherever the factory loads the dataset; inserted only when absent; the reverse
deletes them.
"""
from django.db import migrations

REASON = "Position per the owner's standard: NBA listing plus Basketball-Reference (2026-10-25)"
FIXES = [  # (person_id, old_value, new_value, source)
    (760, None, 'F', 'https://www.basketball-reference.com/players/k/kerseje01.html'),  # Jerome Kersey: Small Forward
    (199, None, 'F', 'https://www.basketball-reference.com/players/w/willire01.html'),  # Reggie Williams: Small Forward
    (103, None, 'G', 'https://www.basketball-reference.com/players/d/dayto01.html'),  # Todd Day: Shooting Guard
    (2804, None, 'F', 'https://www.basketball-reference.com/players/n/nocioan01.html'),  # Andres Nocioni: Small Forward and Power Forward
    (201946, None, 'F', 'https://www.basketball-reference.com/players/h/hansbty01.html'),  # Tyler Hansbrough: Power Forward
    (2033, None, 'F', 'https://www.basketball-reference.com/players/f/fizerma01.html'),  # Marcus Fizer: Power Forward and Small Forward
    (61, None, 'F', 'https://www.basketball-reference.com/players/h/herreca01.html'),  # Carl Herrera: Power Forward
    (201164, None, 'G', 'https://www.basketball-reference.com/players/f/fernaru01.html'),  # Rudy Fernandez: Shooting Guard
    (201576, None, 'F-C', 'https://www.basketball-reference.com/players/r/randoan01.html'),  # Anthony Randolph: Power Forward and Center
    (1907, None, 'G', 'https://www.basketball-reference.com/players/c/cummivo01.html'),  # Vonteego Cummings: Point Guard
    (76689, None, 'G-F', 'https://www.basketball-reference.com/players/e/ezersjo01.html'),  # Johnny Ezersky: Forward/Guard
    (101180, None, 'G', 'https://www.basketball-reference.com/players/j/jasiksa01.html'),  # Sarunas Jasikevicius: Point Guard and Shooting Guard
    (2434, None, 'G', 'https://www.basketball-reference.com/players/n/navarju01.html'),  # Juan Carlos Navarro: Shooting Guard
    (77743, None, 'G', 'https://www.basketball-reference.com/players/o/obriera01.html'),  # Buckshot O'Brien: Point Guard and Shooting Guard
    (203106, None, 'F', 'https://www.basketball-reference.com/players/t/tayloje03.html'),  # Jeffery Taylor: Small Forward
    (202399, None, 'F', 'https://www.basketball-reference.com/players/a/adrieje01.html'),  # Jeff Adrien: Power Forward
    (1892, None, 'G', 'https://www.basketball-reference.com/players/l/langdtr01.html'),  # Trajan Langdon: Shooting Guard
    (2751, None, 'F', 'https://www.basketball-reference.com/players/k/khryavi01.html'),  # Viktor Khryapa: Power Forward and Small Forward
    (76114, None, 'G', 'https://www.basketball-reference.com/players/b/barreer01.html'),  # Ernie Barrett: Shooting Guard
    (202396, None, 'F-C', 'https://www.basketball-reference.com/players/s/samuesa01.html'),  # Samardo Samuels: Center and Power Forward
    (202970, None, 'F-C', 'https://www.basketball-reference.com/players/a/ayongu01.html'),  # Gustavo Ayon: Center and Power Forward
    (2565, None, 'G', 'https://www.basketball-reference.com/players/p/planizo01.html'),  # Zoran Planinic: Point Guard and Shooting Guard
    (77556, None, 'F-C', 'https://www.basketball-reference.com/players/m/mcmulma01.html'),  # Mal McMullan: Forward/Center
    (2431, None, 'F-C', 'https://www.basketball-reference.com/players/a/anderda03.html'),  # David Andersen: Power Forward and Center
    (2471, None, 'F', 'https://www.basketball-reference.com/players/b/batismi01.html'),  # Mike Batiste: Power Forward
    (2242, None, 'F', 'https://www.basketball-reference.com/players/m/morrite01.html'),  # Terence Morris: Small Forward
    (77979, None, 'C', 'https://www.basketball-reference.com/players/r/roberbi01.html'),  # Bill Roberts: Center
    (201595, None, 'F-C', 'https://www.basketball-reference.com/players/d/dorsejo01.html'),  # Joey Dorsey: Power Forward and Center
    (78422, None, 'G-F', 'https://www.basketball-reference.com/players/v/vonniwh01.html'),  # Whitey Von Nieda: Guard/Forward
    (200810, None, 'G', 'https://www.basketball-reference.com/players/r/rayal01.html'),  # Allan Ray: Shooting Guard
    (201964, None, 'F', 'https://www.basketball-reference.com/players/c/clavevi01.html'),  # Victor Claver: Small Forward
    (2071, None, 'C', 'https://www.basketball-reference.com/players/o/oyedeol01.html'),  # Olumide Oyedeji: Center
    (77807, None, 'G', 'https://www.basketball-reference.com/players/p/pastuge01.html'),  # George A. Pastushok: Guard
    (992, None, 'G', 'https://www.basketball-reference.com/players/b/brownma01.html'),  # Marcus Brown: Shooting Guard and Point Guard
    (77776, None, 'C', 'https://www.basketball-reference.com/players/o/osullda01.html'),  # Dan O'Sullivan: Center
    (202091, None, 'F', 'https://www.basketball-reference.com/players/c/chrisdi01.html'),  # Dionte Christmas: Small Forward
    (203810, None, 'G', 'https://www.basketball-reference.com/players/w/wareca01.html'),  # Casper Ware: Point Guard
    (1845, None, 'G', 'https://www.basketball-reference.com/players/g/gazean01.html'),  # Andrew Gaze: Shooting Guard
    (715, None, 'C', 'https://www.basketball-reference.com/players/c/cokerjo01.html'),  # John Coker: Center
    (201629, None, 'F', 'https://www.basketball-reference.com/players/h/hunteot01.html'),  # Othello Hunter: Small Forward and Power Forward
    (77889, None, 'F-C', 'https://www.basketball-reference.com/players/p/pughro01.html'),  # Roy Pugh: Center/Forward
    (76769, None, 'F-C', 'https://www.basketball-reference.com/players/g/gaineel01.html'),  # Elmer R. Gainer: Forward/Center
    (77234, None, 'G', 'https://www.basketball-reference.com/players/k/kelleke01.html'),  # Ken Keller: Guard
    (203502, None, 'F', 'https://www.basketball-reference.com/players/m/mitchto02.html'),  # Tony Mitchell: Power Forward
    (77507, None, 'G-F', 'https://www.basketball-reference.com/players/m/mccarho01.html'),  # Howie McCarty: Forward/Guard
    (76548, None, 'F', 'https://www.basketball-reference.com/players/d/dehnere01.html'),  # Red Dehnert: Forward
    (202727, None, 'G', 'https://www.basketball-reference.com/players/l/leslitr01.html'),  # Travis Leslie: Shooting Guard
    (2845, None, 'F', 'https://www.basketball-reference.com/players/d/danieer01.html'),  # Erik Daniels: Small Forward
    (76813, None, 'F', 'https://www.basketball-reference.com/players/g/gillege01.html'),  # Gene Gillette: Forward
    (200799, None, 'G', 'https://www.basketball-reference.com/players/d/diazgu01.html'),  # Guillermo Diaz: Shooting Guard
    (76451, None, 'C', 'https://www.basketball-reference.com/players/c/corleke01.html'),  # Ken Corley: Center
    (77557, None, 'F', 'https://www.basketball-reference.com/players/m/mcnabch01.html'),  # Chet McNabb: Forward
    (2547, 'F', 'F-C', 'https://www.basketball-reference.com/players/b/boshch01.html'),  # Chris Bosh: Center and Power Forward
    (201586, 'F', 'F-C', 'https://www.basketball-reference.com/players/i/ibakase01.html'),  # Serge Ibaka: Power Forward and Center
    (1630596, 'C', 'F-C', 'https://www.basketball-reference.com/players/m/mobleev01.html'),  # Evan Mobley: Power Forward
]


def seed(apps, schema_editor):
    DataCorrection = apps.get_model("trivia", "DataCorrection")
    for pid, old, new, source in FIXES:
        if DataCorrection.objects.filter(person_id=pid, field_path="position").exists():
            continue
        DataCorrection.objects.create(
            person_id=pid, field_path="position", old_value=old, new_value=new, sources=[source], reason=REASON,
            status="active", created_by="owner",
        )


def unseed(apps, schema_editor):
    DataCorrection = apps.get_model("trivia", "DataCorrection")
    DataCorrection.objects.filter(field_path="position", created_by="owner", reason=REASON,
                                  person_id__in=[f[0] for f in FIXES]).delete()


class Migration(migrations.Migration):

    dependencies = [("trivia", "0017_question_label_source")]

    operations = [migrations.RunPython(seed, unseed)]
