import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity,
  ActivityIndicator, RefreshControl, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getTrumpPosts, TrumpPost } from '../services/api';
import {
  areTrumpNotificationsEnabled,
  registerTrumpNotifications,
  unregisterTrumpNotifications,
} from '../services/notifications';

function timeAgo(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
}

const PostCard = ({ item }: { item: TrumpPost }) => (
  <View style={styles.card}>
    {item.isReblog && (
      <View style={styles.reblogBadge}>
        <Ionicons name="repeat" size={12} color="#64748b" />
        <Text style={styles.reblogTxt}>Re-Truth</Text>
      </View>
    )}
    <Text style={styles.content}>{item.content}</Text>
    <View style={styles.meta}>
      <Text style={styles.time}>{timeAgo(item.createdAt)}</Text>
      {item.url ? (
        <TouchableOpacity onPress={() => Linking.openURL(item.url)} hitSlop={8}>
          <Ionicons name="open-outline" size={14} color="#475569" />
        </TouchableOpacity>
      ) : null}
    </View>
  </View>
);

export default function TrumpFeedScreen() {
  const [posts, setPosts] = useState<TrumpPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notificationsOn, setNotificationsOn] = useState(false);
  const [notifLoading, setNotifLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await getTrumpPosts();
      setPosts(result);
    } catch {
      setError('Could not load the feed.\nCheck your internet connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
    areTrumpNotificationsEnabled().then(setNotificationsOn);
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const toggleNotifications = async () => {
    setNotifLoading(true);
    try {
      if (notificationsOn) {
        await unregisterTrumpNotifications();
        setNotificationsOn(false);
      } else {
        const ok = await registerTrumpNotifications();
        setNotificationsOn(ok);
      }
    } finally {
      setNotifLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Ionicons name="cloud-offline-outline" size={40} color="#475569" style={{ marginBottom: 12 }} />
        <Text style={styles.errorTxt}>{error}</Text>
        <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); load(); }}>
          <Text style={styles.retryTxt}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={{ paddingVertical: 8 }}
      data={posts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <PostCard item={item} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.headerTitle}>@realDonaldTrump</Text>
              <Text style={styles.headerSub}>Truth Social · trumpstruth.org</Text>
            </View>
            <TouchableOpacity
              style={[styles.notifBtn, notificationsOn && styles.notifBtnOn]}
              onPress={toggleNotifications}
              disabled={notifLoading}
              hitSlop={8}
            >
              {notifLoading
                ? <ActivityIndicator size="small" color={notificationsOn ? '#fff' : '#6366f1'} />
                : <Ionicons
                    name={notificationsOn ? 'notifications' : 'notifications-outline'}
                    size={18}
                    color={notificationsOn ? '#fff' : '#6366f1'}
                  />
              }
              <Text style={[styles.notifTxt, notificationsOn && styles.notifTxtOn]}>
                {notificationsOn ? 'Ativo' : 'Notificar'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      }
      ListEmptyComponent={
        <Text style={[styles.errorTxt, { marginTop: 40 }]}>Sem posts disponíveis.</Text>
      }
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f0f' },
  centered: { flex: 1, backgroundColor: '#0f0f0f', justifyContent: 'center', alignItems: 'center', padding: 24 },

  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
    marginBottom: 4,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: { color: '#f8fafc', fontSize: 16, fontWeight: '700' },
  headerSub: { color: '#475569', fontSize: 12, marginTop: 2 },
  notifBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#6366f1',
    backgroundColor: 'transparent',
  },
  notifBtnOn: {
    backgroundColor: '#6366f1',
    borderColor: '#6366f1',
  },
  notifTxt: { color: '#6366f1', fontSize: 12, fontWeight: '600' },
  notifTxtOn: { color: '#fff' },

  card: {
    marginHorizontal: 12,
    marginVertical: 5,
    backgroundColor: '#171c1f',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#22292f',
  },
  reblogBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  reblogTxt: { color: '#64748b', fontSize: 11 },
  content: { color: '#e2e8f0', fontSize: 15, lineHeight: 22 },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 10,
  },
  time: { color: '#475569', fontSize: 12 },

  errorTxt: { color: '#94a3b8', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 20 },
  retryBtn: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryTxt: { color: '#fff', fontWeight: '700' },
});
