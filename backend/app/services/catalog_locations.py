from functools import lru_cache

import geonamescache


@lru_cache(maxsize=1)
def locations():
    return geonamescache.GeonamesCache().get_countries()


def resolve_location(country_code):
    country = locations().get(country_code)
    return {"country_name": country["name"]} if country else None
