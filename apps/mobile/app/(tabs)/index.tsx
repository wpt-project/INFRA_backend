// app/(tabs)/index.tsx
import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TouchableOpacity,
  TextInput,
  StatusBar,
  Platform,
  Modal,
  Alert,
  Keyboard,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import * as Contacts from 'expo-contacts';

// ─── Constants ──────────────────────────────────────────────────────────────

const COLORS = {
  bg: '#0B0F14',
  bg2: '#15171C',
  bg3: '#1C1C1E',
  text: '#F3F3F4',
  textDim: '#9AA0AC',
  accent: '#3FC6B8',
  accentDim: 'rgba(63,198,184,0.12)',
  border: '#2E323C',
  error: '#E5484D',
  success: '#3FC6B8',
  incomingBubble: '#2C2C2E',
  outgoingBubble: '#3FC6B8',
};

const FONTS = {
  heading: 'Lora-Bold',
  body: 'Inter-Regular',
  bodyMedium: 'Inter-Medium',
};

// ─── Types ──────────────────────────────────────────────────────────────────

interface Message {
  id: string;
  text: string;
  sent: boolean;
  time: string;
}

interface Contact {
  id: string;
  name: string;
  phone: string;
  initials: string;
  avatar: string | null;
}

interface Chat {
  id: string;                // unique chat ID (could be contact id)
  contact: Contact;
  messages: Message[];
  lastMessage?: string;
  lastMessageTime?: string;
}

// ─── Sub‑components ──────────────────────────────────────────────────────

// Header
const Header = ({
  onSearchPress,
  onMenuPress,
}: {
  onSearchPress: () => void;
  onMenuPress: () => void;
}) => (
  <View style={styles.header}>
    <Text style={styles.headerTitle}>Chats</Text>
    <View style={styles.headerRight}>
      <TouchableOpacity style={styles.headerIcon} onPress={onSearchPress} hitSlop={8}>
        <Ionicons name="search-outline" size={24} color={COLORS.text} />
      </TouchableOpacity>
      <TouchableOpacity style={styles.headerIcon} onPress={onMenuPress} hitSlop={8}>
        <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
      </TouchableOpacity>
    </View>
  </View>
);

// Chat Item – shows a chat conversation
const ChatItem = ({
  chat,
  onPress,
}: {
  chat: Chat;
  onPress: () => void;
}) => (
  <TouchableOpacity style={styles.chatItem} activeOpacity={0.7} onPress={onPress}>
    <View style={styles.avatarContainer}>
      {chat.contact.avatar ? (
        <Image source={{ uri: chat.contact.avatar }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarPlaceholder}>
          <Text style={styles.avatarText}>{chat.contact.initials}</Text>
        </View>
      )}
    </View>
    <View style={styles.chatInfo}>
      <View style={styles.chatTop}>
        <Text style={styles.chatName} numberOfLines={1}>
          {chat.contact.name}
        </Text>
        <Text style={styles.chatTime}>
          {chat.lastMessageTime || ''}
        </Text>
      </View>
      <View style={styles.chatBottom}>
        <Text style={styles.chatMessage} numberOfLines={1}>
          {chat.lastMessage || 'No messages yet'}
        </Text>
      </View>
    </View>
  </TouchableOpacity>
);

// Empty State for the chat list
const EmptyState = () => (
  <View style={styles.emptyContainer}>
    <View style={styles.emptyIconContainer}>
      <Ionicons name="chatbubbles-outline" size={56} color={COLORS.textDim} />
    </View>
    <Text style={styles.emptyTitle}>No chats yet</Text>
    <Text style={styles.emptySubtitle}>
      Tap the + button below to start a new conversation.
    </Text>
  </View>
);

// Contact picker modal
const ContactPickerModal = ({
  visible,
  onClose,
  onSelectContact,
  loading,
  contacts,
  permissionDenied,
  onRequestPermission,
  onOpenSettings,
}: {
  visible: boolean;
  onClose: () => void;
  onSelectContact: (contact: Contact) => void;
  loading: boolean;
  contacts: Contact[];
  permissionDenied: boolean;
  onRequestPermission: () => void;
  onOpenSettings: () => void;
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredContacts = contacts.filter((c) =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phone.includes(searchQuery)
  );

  const renderContact = ({ item }: { item: Contact }) => (
    <TouchableOpacity
      style={styles.contactItem}
      onPress={() => {
        onSelectContact(item);
        onClose();
      }}
    >
      <View style={styles.avatarContainer}>
        {item.avatar ? (
          <Image source={{ uri: item.avatar }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarPlaceholder}>
            <Text style={styles.avatarText}>{item.initials}</Text>
          </View>
        )}
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.contactName}>{item.name}</Text>
        <Text style={styles.contactPhone}>{item.phone}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      transparent={false}
    >
      <SafeAreaView style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose} style={styles.modalBackButton}>
            <Ionicons name="close" size={28} color={COLORS.text} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Select contact</Text>
          <View style={{ width: 28 }} />
        </View>

        {permissionDenied ? (
          <View style={styles.modalEmpty}>
            <Ionicons name="lock-closed-outline" size={48} color={COLORS.textDim} />
            <Text style={styles.modalEmptyText}>Permission denied</Text>
            <TouchableOpacity style={styles.emptyButton} onPress={onOpenSettings}>
              <Text style={styles.emptyButtonText}>Open Settings</Text>
            </TouchableOpacity>
          </View>
        ) : loading ? (
          <View style={styles.modalEmpty}>
            <ActivityIndicator size="large" color={COLORS.accent} />
            <Text style={styles.modalEmptyText}>Loading contacts...</Text>
          </View>
        ) : (
          <>
            <View style={styles.searchContainer}>
              <View style={styles.searchInputContainer}>
                <Ionicons name="search" size={20} color={COLORS.textDim} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search contacts..."
                  placeholderTextColor={COLORS.textDim}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
              </View>
            </View>
            <FlatList
              data={filteredContacts}
              keyExtractor={(item) => item.id}
              renderItem={renderContact}
              contentContainerStyle={styles.modalList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <Text style={styles.modalEmptyText}>No contacts found</Text>
              }
            />
          </>
        )}
      </SafeAreaView>
    </Modal>
  );
};

// ─── Chat View (unchanged from previous version) ───────────────────────────

const ChatView = ({
  chat,
  onBack,
  setChatMessages,
}: {
  chat: Chat;
  onBack: () => void;
  setChatMessages: (chatId: string, messages: Message[]) => void;
}) => {
  const [inputText, setInputText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const flatListRef = useRef<FlatList>(null);
  const typingTimeout = useRef<NodeJS.Timeout | null>(null);
  const keyboardHeight = useKeyboardHeight();

  const scrollToBottom = () => {
    setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  useEffect(() => {
    scrollToBottom();
  }, [chat.messages]);

  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', scrollToBottom);
    return () => keyboardDidShow.remove();
  }, []);

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const newMsg: Message = {
      id: `m${Date.now()}`,
      text: inputText.trim(),
      sent: true,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const updatedMessages = [...chat.messages, newMsg];
    setChatMessages(chat.id, updatedMessages);
    setInputText('');

    // Simulate reply
    setIsTyping(true);
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => {
      setIsTyping(false);
      const replies = [
        "That's great!",
        'Got it, thanks!',
        'Sounds good to me.',
        'I agree.',
        'Let me think about that.',
        'Sure, no problem.',
        "I'll get back to you.",
        'Awesome!',
      ];
      const reply: Message = {
        id: `m${Date.now() + 1}`,
        text: replies[Math.floor(Math.random() * replies.length)],
        sent: false,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      const newMessages = [...updatedMessages, reply];
      setChatMessages(chat.id, newMessages);
    }, 1000 + Math.random() * 1500);
  };

  const renderMessage = ({ item }: { item: Message }) => (
    <View
      style={[
        styles.messageRow,
        item.sent ? styles.messageRowSent : styles.messageRowReceived,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          item.sent ? styles.sentBubble : styles.receivedBubble,
        ]}
      >
        <Text style={styles.messageText}>{item.text}</Text>
        <Text style={styles.messageTime}>{item.time}</Text>
      </View>
    </View>
  );

  const renderTypingIndicator = () => (
    <View style={styles.typingContainer}>
      <View style={[styles.messageBubble, styles.receivedBubble]}>
        <View style={styles.typingDots}>
          <View style={[styles.typingDot, styles.typingDot1]} />
          <View style={[styles.typingDot, styles.typingDot2]} />
          <View style={[styles.typingDot, styles.typingDot3]} />
        </View>
      </View>
    </View>
  );

  const inputBarPaddingBottom = keyboardHeight > 0 ? keyboardHeight + 12 : 12;

  return (
    <View style={styles.chatView}>
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="chevron-back" size={28} color={COLORS.text} />
        </TouchableOpacity>
        <View style={styles.chatHeaderInfo}>
          <Text style={styles.chatHeaderName}>{chat.contact.name}</Text>
          <Text style={styles.chatHeaderStatus}>{chat.contact.phone}</Text>
        </View>
        <TouchableOpacity style={styles.chatHeaderIcon}>
          <Ionicons name="ellipsis-vertical" size={24} color={COLORS.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.chatBody}>
        <FlatList
          ref={flatListRef}
          data={chat.messages}
          keyExtractor={(item) => item.id}
          renderItem={renderMessage}
          contentContainerStyle={[
            styles.messagesList,
            { paddingBottom: 80 + keyboardHeight },
          ]}
          ListFooterComponent={isTyping ? renderTypingIndicator : null}
          showsVerticalScrollIndicator={false}
        />

        <View style={[styles.inputBar, { paddingBottom: inputBarPaddingBottom }]}>
          <TouchableOpacity style={styles.attachButton}>
            <Ionicons name="attach" size={24} color={COLORS.textDim} />
          </TouchableOpacity>
          <TextInput
            style={styles.inputField}
            placeholder="Type a message..."
            placeholderTextColor={COLORS.textDim}
            value={inputText}
            onChangeText={setInputText}
            returnKeyType="send"
            onSubmitEditing={sendMessage}
            multiline
          />
          <TouchableOpacity style={styles.sendButton} onPress={sendMessage}>
            <Ionicons name="send" size={20} color={COLORS.bg} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

// ─── Main Screen ────────────────────────────────────────────────────────────

export default function ChatListScreen() {
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);

  // Chats state
  const [chats, setChats] = useState<Chat[]>([]);

  // Contact picker state
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // ─── Helper: update messages for a chat ──────────────────────────────

  const setChatMessages = (chatId: string, messages: Message[]) => {
    setChats((prev) =>
      prev.map((c) =>
        c.id === chatId
          ? {
              ...c,
              messages,
              lastMessage: messages.length > 0 ? messages[messages.length - 1].text : '',
              lastMessageTime:
                messages.length > 0 ? messages[messages.length - 1].time : '',
            }
          : c
      )
    );
  };

  // ─── Load contacts for picker ──────────────────────────────────────────

  const loadContactsForPicker = async () => {
    setLoadingContacts(true);
    setPermissionDenied(false);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        setPermissionDenied(true);
        setLoadingContacts(false);
        return;
      }

      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.Name, Contacts.Fields.PhoneNumbers, Contacts.Fields.Image],
      });

      const contactList: Contact[] = data
        .filter((c) => c.phoneNumbers && c.phoneNumbers.length > 0)
        .map((c) => {
          const name = c.name || 'Unknown';
          const phone = c.phoneNumbers?.[0]?.number || '';
          const initials = name
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);
          return {
            id: c.id || `contact-${Date.now()}`,
            name,
            phone,
            initials,
            avatar: c.image?.uri || null,
          };
        });

      setContacts(contactList);
    } catch (error) {
      console.error('Failed to load contacts', error);
      Alert.alert('Error', 'Could not load contacts.');
    } finally {
      setLoadingContacts(false);
    }
  };

  // ─── Open contact picker ───────────────────────────────────────────────

  const openContactPicker = async () => {
    setShowContactPicker(true);
    await loadContactsForPicker();
  };

  // ─── Select a contact → create or open chat ──────────────────────────

  const selectContact = (contact: Contact) => {
    // Check if a chat already exists with this contact (by phone or id)
    const existingChat = chats.find(
      (c) =>
        c.contact.id === contact.id || c.contact.phone === contact.phone
    );
    if (existingChat) {
      setSelectedChatId(existingChat.id);
    } else {
      // Create new chat
      const newChat: Chat = {
        id: `chat-${Date.now()}`,
        contact,
        messages: [],
        lastMessage: 'Start chatting...',
        lastMessageTime: '',
      };
      setChats((prev) => [...prev, newChat]);
      setSelectedChatId(newChat.id);
    }
    setShowContactPicker(false);
  };

  // ─── Handlers ───────────────────────────────────────────────────────────

  const toggleSearch = () => {
    setShowSearch(!showSearch);
    if (showSearch) setSearchQuery('');
  };

  const handleChatPress = (chatId: string) => {
    setSelectedChatId(chatId);
  };

  const handleBackFromChat = () => {
    setSelectedChatId(null);
  };

  const handleMenuPress = () => setShowMenu(true);
  const handleMenuOption = (option: string) => {
    setShowMenu(false);
    Alert.alert(option, `You selected "${option}"`);
  };

  const filteredChats = chats.filter((c) =>
    c.contact.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ─── Selected chat object ─────────────────────────────────────────────

  const selectedChat = chats.find((c) => c.id === selectedChatId) || null;

  // ─── Render ─────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <View style={styles.content}>
        <Header onSearchPress={toggleSearch} onMenuPress={handleMenuPress} />

        {showSearch && (
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Ionicons name="search" size={20} color={COLORS.textDim} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search chats..."
                placeholderTextColor={COLORS.textDim}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
                returnKeyType="done"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')}>
                  <Ionicons name="close-circle" size={20} color={COLORS.textDim} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}

        {filteredChats.length > 0 ? (
          <FlatList
            data={filteredChats}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <ChatItem chat={item} onPress={() => handleChatPress(item.id)} />
            )}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
          />
        ) : (
          <EmptyState />
        )}

        {/* FAB */}
        <TouchableOpacity style={styles.fab} onPress={openContactPicker}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Chat overlay */}
      {selectedChat && (
        <View style={StyleSheet.absoluteFillObject}>
          <ChatView
            chat={selectedChat}
            onBack={handleBackFromChat}
            setChatMessages={setChatMessages}
          />
        </View>
      )}

      {/* Contact Picker Modal */}
      <ContactPickerModal
        visible={showContactPicker}
        onClose={() => setShowContactPicker(false)}
        onSelectContact={selectContact}
        loading={loadingContacts}
        contacts={contacts}
        permissionDenied={permissionDenied}
        onRequestPermission={loadContactsForPicker}
        onOpenSettings={() => Linking.openSettings()}
      />

      {/* Menu Modal */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <TouchableOpacity
          style={styles.menuOverlay}
          activeOpacity={1}
          onPress={() => setShowMenu(false)}
        >
          <View style={styles.menuContainer}>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('New Group')}
            >
              <Ionicons name="people-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuText}>New Group</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.menuItem}
              onPress={() => handleMenuOption('Settings')}
            >
              <Ionicons name="settings-outline" size={22} color={COLORS.text} />
              <Text style={styles.menuText}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.menuItem, styles.menuItemDanger]}
              onPress={() => handleMenuOption('Logout')}
            >
              <Ionicons name="log-out-outline" size={22} color={COLORS.error} />
              <Text style={[styles.menuText, styles.menuTextDanger]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────
// (Mostly the same as before, but we add FAB and contact modal styles)
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  content: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 8 : 12,
    paddingBottom: 16,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: 28,
    fontFamily: FONTS.heading,
    color: COLORS.text,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerIcon: {
    padding: 4,
  },
  searchContainer: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: COLORS.bg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  searchInputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.bg2,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    color: COLORS.text,
    fontSize: 15,
    fontFamily: FONTS.body,
  },
  listContent: {
    paddingTop: 8,
    paddingBottom: 80, // space for FAB
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  avatarContainer: {
    position: 'relative',
    marginRight: 14,
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
  },
  avatarPlaceholder: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: COLORS.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  chatInfo: {
    flex: 1,
  },
  chatTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  chatTime: {
    fontSize: 11,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
  },
  chatBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chatMessage: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
    marginRight: 12,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingBottom: 80, // account for FAB
  },
  emptyIconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: COLORS.bg2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: 22,
    fontWeight: '600',
    color: COLORS.text,
    marginBottom: 8,
    fontFamily: FONTS.heading,
  },
  emptySubtitle: {
    fontSize: 14,
    color: COLORS.textDim,
    textAlign: 'center',
    marginBottom: 24,
    fontFamily: FONTS.body,
  },
  emptyButton: {
    backgroundColor: COLORS.accent,
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  emptyButtonText: {
    color: COLORS.bg,
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONTS.bodyMedium,
  },
  // FAB
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 30,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.accent,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
  },
  // Contact picker modal
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  modalBackButton: {
    padding: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  modalList: {
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  contactInfo: {
    flex: 1,
    marginLeft: 12,
  },
  contactName: {
    fontSize: 16,
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  contactPhone: {
    fontSize: 13,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
  },
  modalEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
  },
  modalEmptyText: {
    fontSize: 16,
    color: COLORS.textDim,
    marginTop: 12,
    fontFamily: FONTS.body,
    textAlign: 'center',
  },
  // Chat view styles (unchanged)
  chatView: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: COLORS.bg2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingTop: Platform.OS === 'ios' ? 8 : 12,
  },
  backButton: {
    padding: 4,
    marginRight: 8,
  },
  chatHeaderInfo: {
    flex: 1,
  },
  chatHeaderName: {
    fontSize: 18,
    fontWeight: '600',
    color: COLORS.text,
    fontFamily: FONTS.bodyMedium,
  },
  chatHeaderStatus: {
    fontSize: 13,
    color: COLORS.textDim,
    fontFamily: FONTS.body,
  },
  chatHeaderIcon: {
    padding: 4,
  },
  chatBody: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  messagesList: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexGrow: 1,
    justifyContent: 'flex-end',
  },
  messageRow: {
    marginBottom: 12,
  },
  messageRowSent: {
    alignItems: 'flex-end',
  },
  messageRowReceived: {
    alignItems: 'flex-start',
  },
  messageBubble: {
    maxWidth: '80%',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
  },
  sentBubble: {
    backgroundColor: COLORS.outgoingBubble,
    borderBottomRightRadius: 4,
  },
  receivedBubble: {
    backgroundColor: COLORS.incomingBubble,
    borderBottomLeftRadius: 4,
  },
  messageText: {
    fontSize: 16,
    color: COLORS.text,
    fontFamily: FONTS.body,
  },
  messageTime: {
    fontSize: 10,
    color: COLORS.textDim,
    marginTop: 4,
    alignSelf: 'flex-end',
    fontFamily: FONTS.body,
  },
  typingContainer: {
    marginBottom: 12,
    alignItems: 'flex-start',
  },
  typingDots: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 4,
  },
  typingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.textDim,
    opacity: 0.4,
  },
  typingDot1: {
    opacity: 0.8,
  },
  typingDot2: {
    opacity: 0.5,
  },
  typingDot3: {
    opacity: 0.3,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: COLORS.bg2,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingBottom: 12,
  },
  attachButton: {
    marginRight: 12,
  },
  inputField: {
    flex: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    color: COLORS.text,
    fontSize: 16,
    fontFamily: FONTS.body,
    maxHeight: 100,
  },
  sendButton: {
    marginLeft: 12,
    backgroundColor: COLORS.accent,
    borderRadius: 20,
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-start',
    paddingTop: Platform.OS === 'ios' ? 80 : 60,
    alignItems: 'flex-end',
    paddingRight: 20,
  },
  menuContainer: {
    backgroundColor: COLORS.bg2,
    borderRadius: 12,
    paddingVertical: 8,
    minWidth: 180,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  menuItemDanger: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  menuText: {
    fontSize: 16,
    color: COLORS.text,
    marginLeft: 12,
    fontFamily: FONTS.body,
  },
  menuTextDanger: {
    color: COLORS.error,
  },
});