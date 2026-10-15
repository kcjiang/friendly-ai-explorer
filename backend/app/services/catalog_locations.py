from functools import lru_cache
import geonamescache


@lru_cache(maxsize=1)
def locations():
    cache = geonamescache.GeonamesCache(min_city_population=15000)
    return cache.get_countries(), cache.get_cities()


def resolve_location(country_code, city_id):
    countries, cities = locations()
    country, city = countries.get(country_code), cities.get(city_id)
    if not country or not city or city['countrycode'] != country_code:
        return None
    return {'country_name': country['name'], 'city_name': city['name']}
