import os
import json
import random
import time
import pandas as pd
from nba_api.stats.static import teams
from nba_api.stats.endpoints import leaguegamefinder, boxscoretraditionalv2
from .logo_utils import logo  # Assuming you have a logo() helper


def build_starting_five_database(output_path="starting_five_data.json", max_games_per_season=50):
    """
    Fetches a large collection of games with their starting fives and saves to a local JSON file.
    This allows the view to serve data instantly without repeated NBA API calls.
    """

    # Step 1: Go far back in time for more variety
    available_seasons = [
        '2010-11', '2011-12', '2012-13', '2013-14', '2014-15',
        '2015-16', '2016-17', '2017-18', '2018-19', '2019-20',
        '2020-21', '2021-22', '2022-23', '2023-24', '2024-25'
    ]

    all_teams = {t["id"]: t for t in teams.get_teams()}
    all_data = []

    for season in available_seasons:
        print(f"Fetching games for season {season}...")

        try:
            # Regular Season
            regular_df = leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable='00',
                season_type_nullable='Regular Season',
            ).get_data_frames()[0]

            # Playoffs
            playoffs_df = leaguegamefinder.LeagueGameFinder(
                season_nullable=season,
                league_id_nullable='00',
                season_type_nullable='Playoffs',
            ).get_data_frames()[0]

            all_games_df = pd.concat([regular_df, playoffs_df], ignore_index=True)

            if all_games_df.empty:
                print(f"No games found for {season}")
                continue

            # Shuffle and limit to avoid too many API calls
            game_ids = list(all_games_df['GAME_ID'].unique())
            random.shuffle(game_ids)
            game_ids = game_ids[:max_games_per_season]

            # Process each game
            for game_id in game_ids:
                try:
                    boxscore = boxscoretraditionalv2.BoxScoreTraditionalV2(
                        game_id=game_id,
                    )

                    players_df = boxscore.player_stats.get_data_frame()
                    teams_in_game = players_df['TEAM_ID'].unique()

                    if len(teams_in_game) != 2:
                        continue  # skip if invalid

                    team_a_id, team_b_id = teams_in_game

                    # Compute team scores
                    team_a_score = int(players_df[players_df['TEAM_ID'] == team_a_id]['PTS'].sum())
                    team_b_score = int(players_df[players_df['TEAM_ID'] == team_b_id]['PTS'].sum())
                    final_score = f"{team_a_score} - {team_b_score}"

                    # Determine winner
                    winning_team_id = team_a_id if team_a_score > team_b_score else team_b_id

                    starters_df = players_df[
                        (players_df['TEAM_ID'] == winning_team_id) &
                        (players_df['START_POSITION'] != '')
                    ]

                    # Split by position
                    forwards = starters_df[starters_df['START_POSITION'] == 'F']
                    guards = starters_df[starters_df['START_POSITION'] == 'G']
                    centers = starters_df[starters_df['START_POSITION'] == 'C']

                    def pick_players(df, n):
                        return df.head(n) if len(df) >= n else df

                    forwards_picked = pick_players(forwards, 2)
                    guards_picked = pick_players(guards, 2)
                    centers_picked = pick_players(centers, 1)

                    # Fill missing spots if needed
                    remaining_needed = 5 - (len(forwards_picked) + len(guards_picked) + len(centers_picked))
                    if remaining_needed > 0:
                        others = starters_df[
                            ~starters_df['PLAYER_NAME'].isin(
                                list(forwards_picked['PLAYER_NAME']) +
                                list(guards_picked['PLAYER_NAME']) +
                                list(centers_picked['PLAYER_NAME'])
                            )
                        ].head(remaining_needed)
                    else:
                        others = pd.DataFrame()

                    # Final starting five
                    starting_5_df = pd.concat([forwards_picked, guards_picked, centers_picked, others])
                    starting_5 = starting_5_df[['PLAYER_NAME', 'START_POSITION']].to_dict('records')

                    # Build the final game object
                    row = all_games_df[all_games_df['GAME_ID'] == game_id].iloc[0]
                    game_data = {
                        'game_id': game_id,
                        'game_date': str(row['GAME_DATE']),
                        'team_a': all_teams[int(team_a_id)]['full_name'],
                        'team_b': all_teams[int(team_b_id)]['full_name'],
                        'team_a_logo': logo(int(team_a_id)),
                        'team_b_logo': logo(int(team_b_id)),
                        'final_score': final_score,
                        'winning_team': all_teams[int(winning_team_id)]['full_name'],
                        'starting_5': [
                            {'name': p['PLAYER_NAME'], 'position': p['START_POSITION']} for p in starting_5
                        ]
                    }

                    all_data.append(game_data)

                except Exception as e:
                    print(f"Error processing game {game_id}: {e}")
                    continue

                # Slight delay to avoid rate limits
                time.sleep(0.6)

        except Exception as e:
            print(f"Error fetching season {season}: {e}")
            continue

    # Save to JSON
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(all_data, f, indent=2)

    print(f"\n Saved {len(all_data)} games to: {os.path.abspath(output_path)}\n")



if __name__ == "__main__":
    # Determine where to save the JSON file
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, "starting_five_data.json")

    print("Building local starting five database...")
    build_starting_five_database(output_path=output_path, max_games_per_season=50)
