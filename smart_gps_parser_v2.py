#!/usr/bin/env python3
"""
Умный парсер GPS v4.2 - ФИНАЛЬНАЯ ВЕРСИЯ
Исправления:
- Фильтрация ложной точки старта
- Интерполяция высоты (нет падений на 0)
- Очистка выбросов в начале и конце
"""

import struct
import csv
from collections import defaultdict
import math

class SmartGPSParserV2:
    def __init__(self, filename):
        print(f"🚁 Загрузка файла: {filename}")
        with open(filename, 'rb') as f:
            self.data = f.read()
        print(f"📊 Размер: {len(self.data)/1024/1024:.2f} МБ\n")
        
        self.records = []
        self.gps_known = []
        self.gps_discovered = []
        self.gps_all = []
        self.telemetry = []
        
        self.coord_history = []
        self.region_center = None
    
    def find_records(self):
        """Поиск всех записей с маркером 0x7E"""
        records = []
        i = 0
        while i < len(self.data):
            if self.data[i] == 0x7E:
                next_pos = self.data.find(b'\x7E', i + 1)
                if next_pos == -1:
                    next_pos = len(self.data)
                record = self.data[i:next_pos]
                records.append((i, record))
                i = next_pos
            else:
                i += 1
        return records
    
    def is_valid_coordinate(self, lat, lon):
        """Базовая проверка валидности"""
        if lat is None or lon is None:
            return False
        if not (-90 <= lat <= 90):
            return False
        if not (-180 <= lon <= 180):
            return False
        if abs(lat) < 0.01 and abs(lon) < 0.01:
            return False
        return True
    
    def calculate_distance(self, lat1, lon1, lat2, lon2):
        """Расчет расстояния (км)"""
        R = 6371
        lat1_rad = math.radians(lat1)
        lat2_rad = math.radians(lat2)
        delta_lat = math.radians(lat2 - lat1)
        delta_lon = math.radians(lon2 - lon1)
        
        a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c
    
    def is_geographically_coherent(self, lat, lon, max_jump_km=50):
        """Проверка географической когерентности"""
        if not self.coord_history:
            return True
        
        recent_coords = self.coord_history[-10:]
        min_distance = float('inf')
        
        for hist_lat, hist_lon in recent_coords:
            dist = self.calculate_distance(lat, lon, hist_lat, hist_lon)
            min_distance = min(min_distance, dist)
        
        return min_distance < max_jump_km
    
    def is_in_reasonable_region(self, lat, lon):
        """Проверка региона"""
        if self.region_center is None:
            return True
        
        center_lat, center_lon = self.region_center
        max_distance = 200
        distance = self.calculate_distance(lat, lon, center_lat, center_lon)
        
        return distance < max_distance
    
    def update_region_center(self):
        """Обновление центра региона"""
        if not self.coord_history:
            return
        
        lats = [c[0] for c in self.coord_history]
        lons = [c[1] for c in self.coord_history]
        
        lats_sorted = sorted(lats)
        lons_sorted = sorted(lons)
        
        median_lat = lats_sorted[len(lats_sorted)//2]
        median_lon = lons_sorted[len(lons_sorted)//2]
        
        self.region_center = (median_lat, median_lon)
    
    def find_gps_in_record(self, record):
        """Поиск GPS в записи"""
        if len(record) < 12:
            return []
        
        candidates = []
        
        for offset in range(4, min(len(record) - 8, 80)):
            try:
                lat = struct.unpack('<f', record[offset:offset+4])[0]
                lon = struct.unpack('<f', record[offset+4:offset+8])[0]
                
                if not self.is_valid_coordinate(lat, lon):
                    continue
                
                if abs(lat) < 1.0 and abs(lon) < 1.0:
                    continue
                
                if not self.is_geographically_coherent(lat, lon, max_jump_km=50):
                    continue
                
                if len(self.coord_history) > 10:
                    if not self.is_in_reasonable_region(lat, lon):
                        continue
                
                alt = None
                if offset + 12 <= len(record):
                    try:
                        alt_candidate = struct.unpack('<f', record[offset+8:offset+12])[0]
                        if -500 < alt_candidate < 10000:
                            alt = alt_candidate
                    except:
                        pass
                
                candidates.append({
                    'offset': offset,
                    'latitude': lat,
                    'longitude': lon,
                    'altitude': alt
                })
                
            except:
                continue
        
        return candidates
    
    def parse_known_gps_absolute(self, record):
        """Парсинг GPS 0x23 0x52"""
        if len(record) < 36:
            return None
        
        if not (record[1] == 0x23 and record[2] == 0x52):
            return None
        
        try:
            counter = struct.unpack('<I', record[4:8])[0]
            latitude = struct.unpack('<f', record[24:28])[0]
            longitude = struct.unpack('<f', record[28:32])[0]
            altitude = struct.unpack('<f', record[32:36])[0]
            
            if not self.is_valid_coordinate(latitude, longitude):
                return None
            
            return {
                'source': 'KNOWN_TYPE',
                'type_hex': record[1:4].hex(),
                'counter': counter,
                'latitude': latitude,
                'longitude': longitude,
                'altitude': altitude,
                'record_offset': 24
            }
        except:
            return None
    
    def parse_known_gps_relative(self, record):
        """Парсинг GPS 0x27 0x52"""
        if len(record) < 40:
            return None
        
        if not (record[1] == 0x27 and record[2] == 0x52):
            return None
        
        try:
            counter = struct.unpack('<I', record[4:8])[0]
            x = struct.unpack('<f', record[20:24])[0]
            y = struct.unpack('<f', record[24:28])[0]
            z = struct.unpack('<f', record[28:32])[0]
            
            return {
                'source': 'KNOWN_RELATIVE',
                'type_hex': record[1:4].hex(),
                'counter': counter,
                'x': x,
                'y': y,
                'z': z,
                'record_offset': 20
            }
        except:
            return None
    
    def parse_ks_telemetry(self, record):
        """Парсинг KS телеметрии"""
        if len(record) < 77:
            return None
        
        try:
            if record[1:3] != b'KS':
                return None
                
            counter = struct.unpack('<I', record[4:8])[0]
            param1 = struct.unpack('<f', record[32:36])[0]
            param2 = struct.unpack('<f', record[36:40])[0]
            param3 = struct.unpack('<f', record[40:44])[0]
            
            return {
                'counter': counter,
                'param1': param1,
                'param2': param2,
                'param3': param3
            }
        except:
            return None
    
    def parse_all(self):
        """Главный метод парсинга"""
        print("🔍 Поиск записей...")
        self.records = self.find_records()
        print(f"✓ Найдено записей: {len(self.records):,}\n")
        
        print("📡 Извлечение GPS данных...")
        print("   [Этап 1] Известные GPS типы")
        print("   [Этап 2] Умный поиск с фильтрацией\n")
        
        print("   Фаза 1: Сбор известных GPS...")
        for idx, (pos, record) in enumerate(self.records):
            if len(record) < 4:
                continue
            
            if record[1] == 0x23 and record[2] == 0x52:
                gps = self.parse_known_gps_absolute(record)
                if gps:
                    self.gps_known.append(gps)
                    self.gps_all.append(gps)
                    self.coord_history.append((gps['latitude'], gps['longitude']))
            
            elif record[1] == 0x27 and record[2] == 0x52:
                gps = self.parse_known_gps_relative(record)
                if gps:
                    self.gps_known.append(gps)
        
        if len(self.coord_history) > 0:
            self.update_region_center()
            print(f"   ✓ Центр региона: {self.region_center[0]:.6f}, {self.region_center[1]:.6f}")
            print(f"   ✓ Известных GPS: {len(self.gps_known):,}\n")
        else:
            print("   ⚠ Известных GPS нет\n")
        
        print("   Фаза 2: Поиск в остальных типах...")
        type_stats = defaultdict(lambda: {'count': 0, 'gps_found': 0})
        
        for idx, (pos, record) in enumerate(self.records):
            if idx % 50000 == 0 and idx > 0:
                print(f"   Обработано: {idx:,}/{len(self.records):,} ({100*idx/len(self.records):.1f}%)")
            
            if len(record) < 4:
                continue
            
            type_hex = record[1:min(4, len(record))].hex()
            type_stats[type_hex]['count'] += 1
            
            if type_hex.startswith(('2352', '2752')):
                continue
            
            if record[1:3] == b'KS':
                tel = self.parse_ks_telemetry(record)
                if tel:
                    self.telemetry.append(tel)
                continue
            
            gps_candidates = self.find_gps_in_record(record)
            
            if gps_candidates:
                best = gps_candidates[0]
                
                self.gps_discovered.append({
                    'source': 'DISCOVERED',
                    'type_hex': type_hex,
                    'latitude': best['latitude'],
                    'longitude': best['longitude'],
                    'altitude': best['altitude'],
                    'record_offset': best['offset'],
                    'record_pos': pos
                })
                
                self.gps_all.append(self.gps_discovered[-1])
                self.coord_history.append((best['latitude'], best['longitude']))
                type_stats[type_hex]['gps_found'] += 1
                
                if len(self.coord_history) % 100 == 0:
                    self.update_region_center()
        
        print(f"   Обработано: {len(self.records):,}/{len(self.records):,} (100.0%)\n")
        
        print("\n" + "=" * 80)
        print("📊 СТАТИСТИКА GPS (топ-10)")
        print("=" * 80)
        print(f"{'Тип':<12} {'Всего':<10} {'С GPS':<10} {'%':<8} {'Статус':<15}")
        print("-" * 80)
        
        sorted_types = sorted(
            [(t, s) for t, s in type_stats.items() if s['gps_found'] > 0],
            key=lambda x: x[1]['gps_found'],
            reverse=True
        )
        
        for type_hex, stats in sorted_types[:10]:
            percent = 100 * stats['gps_found'] / stats['count']
            status = "✓ Известный" if type_hex.startswith(('2352', '2752')) else "⚠ Новый"
            print(f"{type_hex:<12} {stats['count']:<10,} {stats['gps_found']:<10,} {percent:>6.1f}%  {status}")
    
    def print_summary(self):
        """Итоговая статистика"""
        print("\n" + "=" * 80)
        print("📈 ИТОГОВАЯ СТАТИСТИКА")
        print("=" * 80)
        
        print(f"Всего записей: {len(self.records):,}")
        print(f"Телеметрия (KS): {len(self.telemetry):,}")
        print()
        print(f"GPS данные:")
        print(f"  ├─ Известные типы: {len(self.gps_known):,}")
        print(f"  ├─ Найдено в других типах: {len(self.gps_discovered):,}")
        print(f"  └─ ВСЕГО GPS точек: {len(self.gps_all):,}")
        
        if len(self.gps_discovered) > 0 and len(self.gps_known) > 0:
            gain = len(self.gps_discovered) / len(self.gps_known) * 100
            print(f"\n🎯 Восстановлено дополнительно: +{gain:.0f}%!")
        
        if self.gps_all:
            coords = [(g['latitude'], g['longitude']) for g in self.gps_all 
                     if 'latitude' in g and 'longitude' in g]
            
            if coords:
                lats, lons = zip(*coords)
                print(f"\n📍 География:")
                print(f"   Широта:  {min(lats):.6f} - {max(lats):.6f}")
                print(f"   Долгота: {min(lons):.6f} - {max(lons):.6f}")
                print(f"   Центр: {sum(lats)/len(lats):.6f}, {sum(lons)/len(lons):.6f}")
                
                lat_diff = (max(lats) - min(lats)) * 111
                lon_diff = (max(lons) - min(lons)) * 111 * math.cos(math.radians(sum(lats)/len(lats)))
                print(f"   Размер области: {lat_diff:.2f} × {lon_diff:.2f} км")
        
        if len(self.gps_all) > 0 and len(self.telemetry) > 0:
            ratio = len(self.telemetry) / len(self.gps_all)
            print(f"\n⏱  Соотношение телеметрия:GPS = {ratio:.1f}:1")
    
    def interpolate_altitude(self, coords):
        """Интерполяция высоты"""
        result = []
        
        for i, (lon, lat, alt) in enumerate(coords):
            if alt is None or alt <= 0:
                prev_alt = None
                next_alt = None
                
                # Предыдущая с высотой
                for j in range(i-1, max(0, i-20), -1):
                    if coords[j][2] and coords[j][2] > 0:
                        prev_alt = coords[j][2]
                        break
                
                # Следующая с высотой
                for j in range(i+1, min(len(coords), i+20)):
                    if coords[j][2] and coords[j][2] > 0:
                        next_alt = coords[j][2]
                        break
                
                # Интерполяция
                if prev_alt and next_alt:
                    alt = (prev_alt + next_alt) / 2
                elif prev_alt:
                    alt = prev_alt
                elif next_alt:
                    alt = next_alt
                else:
                    alt = 100.0
            
            result.append((lon, lat, alt))
        
        return result
    
    def find_real_start_point(self, coords):
        """Находит реальную точку старта - улучшенная версия"""
        if len(coords) < 20:
            return 0
        
        # Берём координаты из СЕРЕДИНЫ траектории (там точно правильные данные)
        middle_start = len(coords) // 3
        middle_end = 2 * len(coords) // 3
        middle_coords = coords[middle_start:middle_end]
        
        if not middle_coords:
            return 0
        
        # Вычисляем центр региона по середине
        middle_lats = [c[1] for c in middle_coords]
        middle_lons = [c[0] for c in middle_coords]
        
        center_lat = sum(middle_lats) / len(middle_lats)
        center_lon = sum(middle_lons) / len(middle_lons)
        
        # Ищем первую точку, которая БЛИЗКА к этому центру
        max_distance = 30  # уменьшил с 50 до 30 км
        
        for i, (lon, lat, alt) in enumerate(coords):
            dist = self.calculate_distance(lat, lon, center_lat, center_lon)
            if dist < max_distance:
                return i
        
        # Если не нашли - возвращаем 0
        return 0
    
    def export_all_gps_csv(self, filename='gps_complete.csv'):
        """Экспорт GPS"""
        print(f"\n💾 Экспорт GPS в {filename}...")
        
        with open(filename, 'w', newline='', encoding='utf-8') as f:
            writer = csv.DictWriter(f, fieldnames=[
                'source', 'type_hex', 'latitude', 'longitude', 'altitude', 
                'counter', 'record_offset'
            ])
            writer.writeheader()
            
            for gps in self.gps_all:
                writer.writerow({
                    'source': gps.get('source', ''),
                    'type_hex': gps.get('type_hex', ''),
                    'latitude': gps.get('latitude', ''),
                    'longitude': gps.get('longitude', ''),
                    'altitude': gps.get('altitude', ''),
                    'counter': gps.get('counter', ''),
                    'record_offset': gps.get('record_offset', '')
                })
        
        print(f"✓ Экспортировано: {len(self.gps_all):,} GPS точек")
    
    def export_trajectory_kml(self, filename='trajectory.kml'):
        """Экспорт траектории в KML - УЛУЧШЕННЫЙ"""
        print(f"\n🌍 Создание KML: {filename}...")
        
        # Собираем координаты
        raw_coords = [(g['longitude'], g['latitude'], g.get('altitude')) 
                      for g in self.gps_all 
                      if 'latitude' in g and 'longitude' in g]
        
        if not raw_coords:
            print("⚠ Нет координат")
            return
        
        # Находим реальную точку старта (пропускаем выбросы в начале)
        start_idx = self.find_real_start_point(raw_coords)
        
        # Дополнительная защита: если нашли точку слишком рано (< 5), 
        # но есть подозрение на выбросы - пропускаем минимум 10 точек
        if start_idx < 5 and len(raw_coords) > 50:
            # Проверяем: далеко ли первые 10 точек от центра
            middle_coords = raw_coords[len(raw_coords)//3:2*len(raw_coords)//3]
            if middle_coords:
                center_lat = sum(c[1] for c in middle_coords) / len(middle_coords)
                center_lon = sum(c[0] for c in middle_coords) / len(middle_coords)
                
                # Проверяем первые 10 точек
                outliers = 0
                for i in range(min(10, len(raw_coords))):
                    dist = self.calculate_distance(raw_coords[i][1], raw_coords[i][0], 
                                                   center_lat, center_lon)
                    if dist > 30:  # Если дальше 30 км от центра
                        outliers += 1
                
                # Если больше половины точек - выбросы, пропускаем их все
                if outliers > 5:
                    start_idx = 10
                    print(f"   ⚠ Обнаружены выбросы в начале, принудительно пропущено {start_idx} точек")
        
        if start_idx > 0:
            print(f"   ✓ Пропущено {start_idx} выбросов в начале")
            raw_coords = raw_coords[start_idx:]
        
        # Интерполируем высоту (убираем падения на 0)
        coords = self.interpolate_altitude(raw_coords)
        
        if not coords:
            print("⚠ Нет координат")
            return
        
        # Проверяем высоты
        altitudes = [c[2] for c in coords if c[2]]
        if altitudes:
            print(f"   ✓ Высота: {min(altitudes):.1f} - {max(altitudes):.1f} м")
        
        kml = f"""<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <n>Траектория БПЛА</n>
    <description>Точек: {len(coords):,}</description>
    <Style id="path">
      <LineStyle>
        <color>ff0000ff</color>
        <width>3</width>
      </LineStyle>
    </Style>
    <Placemark>
      <n>Траектория</n>
      <styleUrl>#path</styleUrl>
      <LineString>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>
"""
        
        for lon, lat, alt in coords:
            kml += f"          {lon:.8f},{lat:.8f},{alt:.2f}\n"
        
        kml += f"""        </coordinates>
      </LineString>
    </Placemark>
    <Placemark>
      <n>Старт</n>
      <Point>
        <coordinates>{coords[0][0]:.8f},{coords[0][1]:.8f},{coords[0][2]:.2f}</coordinates>
      </Point>
    </Placemark>
    <Placemark>
      <n>Финиш</n>
      <Point>
        <coordinates>{coords[-1][0]:.8f},{coords[-1][1]:.8f},{coords[-1][2]:.2f}</coordinates>
      </Point>
    </Placemark>
  </Document>
</kml>"""
        
        with open(filename, 'w', encoding='utf-8') as f:
            f.write(kml)
        
        print(f"✓ KML создан: {len(coords):,} точек")
        print(f"   ✓ Старт: {coords[0][1]:.6f}, {coords[0][0]:.6f}")
        print(f"   ✓ Финиш: {coords[-1][1]:.6f}, {coords[-1][0]:.6f}")


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Использование: python smart_gps_parser_v2.py <файл.dat>")
        sys.exit(1)
    
    print("=" * 80)
    print("🚁 УМНЫЙ ПАРСЕР GPS v4.2 - ФИНАЛЬНАЯ ВЕРСИЯ")
    print("=" * 80)
    print("Исправления:")
    print("  ✓ Фильтрация ложной точки старта")
    print("  ✓ Интерполяция высоты (нет падений на 0)")
    print("  ✓ Очистка выбросов")
    print()
    
    parser = SmartGPSParserV2(sys.argv[1])
    parser.parse_all()
    parser.print_summary()
    
    print("\n" + "=" * 80)
    print("💾 ЭКСПОРТ")
    print("=" * 80)
    
    parser.export_all_gps_csv()
    parser.export_trajectory_kml()
    
    print("\n" + "=" * 80)
    print("✅ ГОТОВО!")
    print("=" * 80)
    print("\n📋 Проверьте:")
    print("  1. trajectory.kml - точка старта должна быть правильной")
    print("  2. Нет падений высоты на 0")
    print("  3. Траектория непрерывная")
